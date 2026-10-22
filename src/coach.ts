import sharp from 'sharp';
import type { Store } from './db.js';

export type Provider = 'groq' | 'gemini';
export type CoachResult = {instruction:string; nextItem:string; reason:string; coreItems:string[]; situationalItems:string[]; detectedHero:string; confidence:'low'|'medium'|'high'; provider:string};
const SYSTEM = `You are a Mobile Legends Bang Bang (MLBB) item coach. Analyze the attached in-game scoreboard screenshot. Identify the player's hero, current inventory, opposing heroes, enemy damage types, threats and build progression. Never claim to see unreadable details. Choose the single best NEXT ITEM to buy, with a brief explanation, 3 core items and 3 situational options. Respect existing items, avoid suggesting duplicates or removed items, and adapt to current match threats. If screenshot is unreadable or player hero cannot be determined from screenshot or previous context, respond with nextItem="Need clearer scoreboard", confidence="low" and ask for a better screenshot. Never invent current patch details. Return ONLY a JSON object: {"nextItem":"...","reason":"...","coreItems":["...","...","..."],"situationalItems":["...","...","..."],"detectedHero":"...","confidence":"low|medium|high"}. No markdown. Keep reason under 150 characters.`;
function parse(text:string):Omit<CoachResult,'instruction'|'provider'> {
  const clean=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const x=JSON.parse(clean);
  if(typeof x.nextItem!=='string'||typeof x.reason!=='string'||!Array.isArray(x.coreItems)||!Array.isArray(x.situationalItems))throw Error('Model response was not valid coaching JSON');
  const arr=(a:unknown[])=>a.filter((v):v is string=>typeof v==='string').slice(0,3).map(s=>s.slice(0,80));
  return {nextItem:x.nextItem.slice(0,100),reason:x.reason.slice(0,180),coreItems:arr(x.coreItems),situationalItems:arr(x.situationalItems),detectedHero:String(x.detectedHero||'Unknown').slice(0,80),confidence:['low','medium','high'].includes(x.confidence)?x.confidence:'low'};
}
async function api(url:string, headers:Record<string,string>, body:unknown):Promise<any>{
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),25000);
  try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:controller.signal});
    if(!res.ok){const msg=(await res.text()).slice(0,250);const err=new Error(`Provider HTTP ${res.status}: ${msg}`) as Error&{status?:number};err.status=res.status;throw err;}
    return await res.json();
  }finally{clearTimeout(timeout);}
}
async function groq(image:string, prompt:string){const key=process.env.GROQ_API_KEY;if(!key)throw Error('Groq key not configured');
 const model=process.env.GROQ_MODEL||'meta-llama/llama-4-scout-17b-16e-instruct';
 const out=await api('https://api.groq.com/openai/v1/chat/completions',{Authorization:`Bearer ${key}`},{model,temperature:0.15,max_completion_tokens:500,messages:[{role:'system',content:SYSTEM},{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${image}`}}]}]});
 return {text:out.choices?.[0]?.message?.content,provider:`groq:${model}`};
}
async function gemini(image:string,prompt:string){const key=process.env.GEMINI_API_KEY;if(!key)throw Error('Gemini key not configured');
 const model=process.env.GEMINI_MODEL||'gemini-2.5-flash-lite';
 const out=await api(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{'x-goog-api-key':key},{systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:image}}]}],generationConfig:{temperature:0.15,maxOutputTokens:700,responseMimeType:'application/json'}});
 return {text:out.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join(''),provider:`gemini:${model}`};
}
export async function analyzeScreenshot(store:Store,token:string,bytes:Buffer,heroHint?:string):Promise<CoachResult>{
 const game=store.getGame(token);if(!game||game.status!=='active')throw Error('Active game not found');
 const image=await sharp(bytes,{limitInputPixels:20000000}).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
 const previous=store.latestInstruction(game)?.text||'';
 const prompt=`Hero hint (may be empty): ${heroHint||'none'}. Previous recommendation: ${previous.slice(0,400)}. Analyze this screenshot. Prioritize the next item for the player's own hero. If uncertain, say so.`;
 const preferred=(process.env.AI_PRIMARY||'groq').toLowerCase()==='gemini'?'gemini':'groq';
 const order:Provider[]=preferred==='groq'?['groq','gemini']:['gemini','groq'];let lastError:unknown;
 for(const provider of order){if(provider==='groq'&&!process.env.GROQ_API_KEY)continue;if(provider==='gemini'&&!process.env.GEMINI_API_KEY)continue;
   try{const r=provider==='groq'?await groq(image.toString('base64'),prompt):await gemini(image.toString('base64'),prompt);
     const parsed=parse(r.text||'');const instruction=parsed.confidence==='low'&&parsed.nextItem==='Need clearer scoreboard'?'Need a clearer scoreboard screenshot.':`NEXT: ${parsed.nextItem}. ${parsed.reason}`.slice(0,350);
     store.setInstruction(token,instruction);
     return {...parsed,instruction,provider:r.provider};
   }catch(e){lastError=e;console.warn(`${provider} analysis failed:`,e instanceof Error?e.message:e);}
 }
 throw Error(lastError instanceof Error?`No AI provider succeeded: ${lastError.message}`:'No AI provider configured');
}
