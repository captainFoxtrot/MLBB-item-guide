import sharp from 'sharp';
import type { Store } from './db.js';
import type { Screen } from './roster.js';

export type Provider = 'groq' | 'gemini';
export type CoachResult = {screen:Screen; heroes:Array<{side:'ally'|'enemy';position:number;hero:string}>; you:number|null; instruction:string; nextItem:string; reason:string; coreItems:string[]; situationalItems:string[]; detectedHero:string; confidence:'low'|'medium'|'high'; provider:string};
const SYSTEM = `You are an MLBB vision draft/scoreboard reader and item coach. The screenshot can be DRAFT/HERO SELECT, LOADING, SCOREBOARD, or UNKNOWN. Return 10 ordered hero slots, with positions 0-4 (top-to-bottom) for each side, keeping screenshot visual order. Do not sort by hero name or role. Do not infer a hero if it cannot be read. Each detected hero entry is {"side":"ally|enemy","position":0..4,"hero":"Exact hero name"}. "you" is the player's ALLY slot index 0..4 ONLY if highlighted or clearly identified; otherwise null. Use previous manually corrected roster as authoritative. For DRAFT or LOADING, extract heroes without inventing inventory or item recommendations. For SCOREBOARD, identify player's hero, items and enemies; choose one NEXT ITEM and explain, 3 core and 3 situational options, adapting to threats and already purchased items. If no reliable actionable recommendation, return nextItem="Need clearer scoreboard", confidence="low" and do not invent items. Never invent patch details. Return ONLY JSON: {"screen":"draft|loading|scoreboard|unknown","heroes":[{"side":"ally","position":0,"hero":"Pharsa"}],"you":null,"nextItem":"...","reason":"...","coreItems":[],"situationalItems":[],"detectedHero":"...","confidence":"low|medium|high"}. No markdown. Keep reason under 150 chars.`;
function parse(text:string):Omit<CoachResult,'instruction'|'provider'> {
  const clean=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const x=JSON.parse(clean);
  if(!x||typeof x!=='object')throw Error('Model response was not valid coaching JSON');
  const nextItem=typeof x.nextItem==='string'?x.nextItem:'Need clearer scoreboard';
  const reason=typeof x.reason==='string'?x.reason:'Not enough scoreboard information';
  const arr=(a:unknown[])=>a.filter((v):v is string=>typeof v==='string').slice(0,3).map(s=>s.slice(0,80));
  const heroes:Array<{side:'ally'|'enemy';position:number;hero:string}>=Array.isArray(x.heroes)?x.heroes.filter((h:any)=>h&&['ally','enemy'].includes(h.side)&&Number.isInteger(h.position)&&h.position>=0&&h.position<=4&&typeof h.hero==='string').slice(0,10):[];
  const screen:Screen=['draft','loading','scoreboard','unknown'].includes(x.screen)?x.screen:'unknown';
  const you=Number.isInteger(x.you)&&x.you>=0&&x.you<=4?x.you:null;
  return {screen,heroes,you,nextItem:nextItem.slice(0,100),reason:reason.slice(0,180),coreItems:arr(Array.isArray(x.coreItems)?x.coreItems:[]),situationalItems:arr(Array.isArray(x.situationalItems)?x.situationalItems:[]),detectedHero:String(x.detectedHero||'Unknown').slice(0,80),confidence:['low','medium','high'].includes(x.confidence)?x.confidence:'low'};
}
async function api(url:string, headers:Record<string,string>, body:unknown):Promise<any>{
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),25000);
  try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:controller.signal});
    if(!res.ok){const msg=(await res.text()).slice(0,250);const err=new Error(`Provider HTTP ${res.status}: ${msg}`) as Error&{status?:number};err.status=res.status;throw err;}
    return await res.json();
  }finally{clearTimeout(timeout);}
}
async function groq(image:string, prompt:string){const key=process.env.GROQ_API_KEY;if(!key)throw Error('Groq key not configured');
 const model=process.env.GROQ_MODEL||'qwen/qwen3.8-27b';
 const out=await api('https://api.groq.com/openai/v1/chat/completions',{Authorization:`Bearer ${key}`},{model,temperature:0.15,max_completion_tokens:1200,messages:[{role:'system',content:SYSTEM},{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${image}`}}]}]});
 return {text:out.choices?.[0]?.message?.content,provider:`groq:${model}`};
}
async function gemini(image:string,prompt:string){const key=process.env.GEMINI_API_KEY;if(!key)throw Error('Gemini key not configured');
 const model=process.env.GEMINI_MODEL||'gemini-2.5-flash-lite';
 const out=await api(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{'x-goog-api-key':key},{systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:image}}]}],generationConfig:{temperature:0.15,maxOutputTokens:1400,responseMimeType:'application/json'}});
 return {text:out.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join(''),provider:`gemini:${model}`};
}
export async function analyzeScreenshot(store:Store,token:string,bytes:Buffer,heroHint?:string):Promise<CoachResult>{
 const game=store.getGame(token);if(!game||game.status!=='active')throw Error('Active game not found');
 const image=await sharp(bytes,{limitInputPixels:20000000}).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
 const previous=store.latestInstruction(game)?.text||'';
 const roster=store.getRoster(token);
 const slots=roster.slots.map((s,i)=>`${s.side}[${s.position}]=${s.hero||'?'}${s.locked?' (MANUAL LOCK)':''}`).join(', ');
 const own=roster.you!==null?roster.slots[roster.you]?.hero:null;
 const prompt=`Known roster slots: ${slots}. Player's manually selected ally slot: ${roster.you??'unknown'}. Known player hero: ${own||'unknown'}. Hero hint: ${heroHint||'none'}. Previous recommendation: ${previous.slice(0,250)}. Analyze this screenshot, preserving the hero positions exactly. Only recommend items if scoreboard shows enough information and player's hero is known. If uncertain, say so.`;
 const preferred=(process.env.AI_PRIMARY||'groq').toLowerCase()==='gemini'?'gemini':'groq';
 const order:Provider[]=preferred==='groq'?['groq','gemini']:['gemini','groq'];let lastError:unknown;
 for(const provider of order){if(provider==='groq'&&!process.env.GROQ_API_KEY)continue;if(provider==='gemini'&&!process.env.GEMINI_API_KEY)continue;
   try{const r=provider==='groq'?await groq(image.toString('base64'),prompt):await gemini(image.toString('base64'),prompt);
     const parsed=parse(r.text||'');
     const updated=store.applyRosterDetection(token,{heroes:parsed.heroes,you:parsed.you,screen:parsed.screen});
     const valid=parsed.screen==='scoreboard'&&parsed.confidence!=='low'&&parsed.nextItem!=='Need clearer scoreboard'&&updated.you!==null&&!!updated.slots[updated.you]?.hero;
     const instruction=valid?`NEXT: ${parsed.nextItem}. ${parsed.reason}`.slice(0,350):`Heroes updated (${parsed.screen}). Awaiting a clear scoreboard and your hero selection.`;
     if(valid)store.setInstruction(token,instruction);
     return {...parsed,instruction,detectedHero:updated.you!==null?updated.slots[updated.you]?.hero||parsed.detectedHero:parsed.detectedHero,provider:r.provider};
   }catch(e){lastError=e;console.warn(`${provider} analysis failed:`,e instanceof Error?e.message:e);}
 }
 throw Error(lastError instanceof Error?`No AI provider succeeded: ${lastError.message}`:'No AI provider configured');
}
