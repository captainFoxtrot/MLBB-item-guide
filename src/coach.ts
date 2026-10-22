import sharp from 'sharp';
import type { Store } from './db.js';
import type { Screen, Roster } from './roster.js';

export type Provider = 'groq' | 'gemini';
export type AdviceStatus = 'waiting' | 'provisional' | 'actionable';
type Confidence = 'low'|'medium'|'high';
export type MatchState = {
  time:string|null; kills:{ally:number|null;enemy:number|null};
  gold:{ally:number|null;enemy:number|null};
  towers:{ally:number|null;enemy:number|null};
  turtles:{ally:number|null;enemy:number|null};
  lords:{ally:number|null;enemy:number|null};
  player:{level:number|null;kills:number|null;deaths:number|null;assists:number|null;gold:number|null};
  enemyItems:Record<string,string[]>; notes:string[];
};
export type PushDelivery = {attempted:number;delivered:number;failed:number;expired:number;enabled:boolean;errors:string[]};
export type CoachResult = {
  screen:Screen; heroes:Array<{side:'ally'|'enemy';position:number;hero:string}>; you:number|null;
  instruction:string;nextItem:string;reason:string;coreItems:string[];situationalItems:string[];
  detectedHero:string;confidence:Confidence;provider:string;inventory:string[];inventoryReadable:boolean;
  adviceStatus:AdviceStatus;notificationQueued:boolean;notification?:PushDelivery;
  matchState:MatchState;adviceType:'core'|'next'|'none';
};
type Vision = {screen:Screen;heroes:CoachResult['heroes'];you:number|null;inventory:string[];inventoryReadable:boolean;confidence:Confidence;matchState:MatchState};
type Advice = {nextItem:string;reason:string;coreItems:string[];situationalItems:string[];confidence:Confidence};
const WAITING='Select your hero';
const VISION_SYSTEM = `You are a precision Mobile Legends Bang Bang screenshot analyst, not an item coach. Return ONLY JSON. Identify draft, loading, scoreboard, or unknown. Heroes must remain in their exact visual positions 0-4 from top to bottom for each team, never reorder. Omit uncertain hero slots. Only infer YOU if a player indicator is visually unambiguous; otherwise null. For scoreboards extract the selected player's items only if the slot is provided and the item icons are legible; unreadable is NOT empty. Extract game-state evidence: match clock, ally/enemy kills, team gold, towers destroyed, turtle and lord indicators/counts, player level/KDA/gold, visible enemy items. Every unreadable or absent numeric value MUST be null, never guessed. A score may have team order reversed; respect ally/enemy orientation. If an objective indicator is unclear, null. Enemy equipment must be attributed to the correct hero; otherwise omit it. Keep notes factual and short. Do not mistake total towers remaining for destroyed towers. Return JSON with screen, heroes, you, inventory, inventoryReadable, confidence, matchState:{time,kills:{ally,enemy},gold:{ally,enemy},towers:{ally,enemy},turtles:{ally,enemy},lords:{ally,enemy},player:{level,kills,deaths,assists,gold},enemyItems:{},notes:[]}.`;
const ADVICE_SYSTEM = `You are a decisive, tactical MLBB item coach. Your job is to CHOOSE an appropriate item, not to ask for a clearer screenshot. You receive a trusted player hero, ordered teams, inventory visibility and factual match-state evidence. At DRAFT or LOADING: choose a fitting CORE item and 3-item core plan from compositions; give a short threat-specific reason, not an immediate purchase claim. At SCOREBOARD: choose ONE best NEXT item based on enemy threats, kill/gold disadvantage, objective control, player performance and current items, prioritizing what matters most now. Use only metrics provided; unknown is not zero. When inventory is unreadable, still give a provisional choice but do not claim what the player owns or lacks. If inventory is readable, never recommend an already owned item. Include 3 core items and up to 3 situational alternatives; prefer legal, current, hero-appropriate items and no duplicated items. A defensive item must actually counter the named threat: e.g. a magic shield is NOT stun immunity; anti-heal counters sustain, not crowd control. If uncertain, choose a generally appropriate core item and say it is provisional. Keep the reason to 6-16 words, in the style 'Magic burst protection against Karina'. Return ONLY JSON: {"nextItem":"exact item name","reason":"short tactical reason","coreItems":["..."],"situationalItems":["..."],"confidence":"low|medium|high"}.`;
const emptyMatchState=():MatchState=>({time:null,kills:{ally:null,enemy:null},gold:{ally:null,enemy:null},towers:{ally:null,enemy:null},turtles:{ally:null,enemy:null},lords:{ally:null,enemy:null},player:{level:null,kills:null,deaths:null,assists:null,gold:null},enemyItems:{},notes:[]});
function json(text:string):any {const v=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid provider JSON');return v;}
function strings(v:unknown,max=6):string[]{return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string').map(x=>x.trim().slice(0,80)).filter(Boolean).slice(0,max):[];}
function confidence(v:unknown):Confidence{return v==='high'||v==='medium'?v:'low';}
function n(v:unknown):number|null{return typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;}
function pair(v:any){return {ally:n(v?.ally),enemy:n(v?.enemy)};}
export function normalizeMatchState(v:any):MatchState{
 const e=emptyMatchState(),p=v?.player||{};
 const enemyItems:Record<string,string[]>={};
 if(v?.enemyItems&&typeof v.enemyItems==='object'&&!Array.isArray(v.enemyItems))for(const [key,value] of Object.entries(v.enemyItems).slice(0,5)){
  const names=strings(value,6);if(names.length)enemyItems[key.slice(0,80)]=names;
 }
 return {time:typeof v?.time==='string'?v.time.slice(0,12):null,kills:pair(v?.kills),gold:pair(v?.gold),towers:pair(v?.towers),turtles:pair(v?.turtles),lords:pair(v?.lords),player:{level:n(p.level),kills:n(p.kills),deaths:n(p.deaths),assists:n(p.assists),gold:n(p.gold)},enemyItems,notes:strings(v?.notes,5)};
}
function parseVision(text:string):Vision{
 const x=json(text),heroes:Vision['heroes']=[];
 if(Array.isArray(x.heroes))for(const h of x.heroes){if(h&&['ally','enemy'].includes(h.side)&&Number.isInteger(h.position)&&h.position>=0&&h.position<5&&typeof h.hero==='string'&&h.hero.trim()&&!heroes.some(a=>a.side===h.side&&a.position===h.position))heroes.push({side:h.side,position:h.position,hero:h.hero.trim().slice(0,80)});}
 return {screen:['draft','loading','scoreboard','unknown'].includes(x.screen)?x.screen:'unknown',heroes,you:Number.isInteger(x.you)&&x.you>=0&&x.you<5?x.you:null,inventory:strings(x.inventory),inventoryReadable:x.inventoryReadable===true,confidence:confidence(x.confidence),matchState:normalizeMatchState(x.matchState)};
}
function parseAdvice(text:string):Advice{const x=json(text);return {nextItem:typeof x.nextItem==='string'?x.nextItem.trim().slice(0,100):'',reason:typeof x.reason==='string'?x.reason.trim().slice(0,140):'Based on visible enemy threats',coreItems:strings(x.coreItems,3),situationalItems:strings(x.situationalItems,3),confidence:confidence(x.confidence)};}
function sameItem(a:string,b:string){return a.toLowerCase().replace(/[^a-z0-9]/g,'')===b.toLowerCase().replace(/[^a-z0-9]/g,'');}
export function resolvePlayerHero(roster:Roster):string|null{return roster.you===null?null:roster.slots[roster.you]?.hero||null;}
export function decideAdvice(roster:Roster,vision:Vision,advice:Advice|null):{status:AdviceStatus;nextItem:string;reason:string;confidence:Confidence}{
 const hero=resolvePlayerHero(roster);
 if(!hero)return {status:'waiting',nextItem:WAITING,reason:'Select your ally slot using This is me.',confidence:'low'};
 if(vision.screen==='unknown')return {status:'waiting',nextItem:'Waiting for game screen',reason:'No recognizable draft, loading screen, or scoreboard.',confidence:'low'};
 const chosen=advice?.nextItem&&!/^(need clearer|unknown|none|n\/a|wait)/i.test(advice.nextItem)?advice.nextItem:advice?.coreItems.find(Boolean);
 if(!chosen)return {status:'waiting',nextItem:'Coaching unavailable',reason:'Item provider did not return a usable suggestion; check server logs.',confidence:'low'};
 if(vision.screen==='scoreboard'&&vision.inventoryReadable&&vision.inventory.some(item=>sameItem(item,chosen)))return {status:'waiting',nextItem:'Coaching unavailable',reason:'Suggested item is already owned; no duplicate purchase will be sent.',confidence:'low'};
 return {status:vision.screen==='scoreboard'&&vision.inventoryReadable?'actionable':'provisional',nextItem:chosen,reason:advice?.reason||'Team composition and match threats',confidence:vision.screen==='scoreboard'&&vision.inventoryReadable?advice?.confidence||'low':'low'};
}
async function api(url:string,headers:Record<string,string>,body:unknown){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:controller.signal});if(!res.ok)throw Error(`Provider HTTP ${res.status}: ${(await res.text()).slice(0,250)}`);return await res.json();}finally{clearTimeout(timeout);}}
async function groq(system:string,prompt:string,image?:string){const key=process.env.GROQ_API_KEY;if(!key)throw Error('Groq key not configured');const model=process.env.GROQ_MODEL||'qwen/qwen3.8-27b';const content=image?[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${image}`}}]:prompt;const out=await api('https://api.groq.com/openai/v1/chat/completions',{Authorization:`Bearer ${key}`},{model,temperature:0.1,max_completion_tokens:2200,messages:[{role:'system',content:system},{role:'user',content}]});return {text:out.choices?.[0]?.message?.content,provider:`groq:${model}`};}
async function gemini(system:string,prompt:string,image?:string){const key=process.env.GEMINI_API_KEY;if(!key)throw Error('Gemini key not configured');const model=process.env.GEMINI_MODEL||'gemini-2.5-flash-lite';const parts:any[]=[{text:prompt}];if(image)parts.push({inlineData:{mimeType:'image/jpeg',data:image}});const out=await api(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{'x-goog-api-key':key},{systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts}],generationConfig:{temperature:0.1,maxOutputTokens:2200,responseMimeType:'application/json'}});return {text:out.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join(''),provider:`gemini:${model}`};}
async function invoke(system:string,prompt:string,image?:string):Promise<{text:string;provider:string}>{const preferred=(process.env.AI_PRIMARY||'groq').toLowerCase()==='gemini'?'gemini':'groq';const order:Provider[]=preferred==='groq'?['groq','gemini']:['gemini','groq'];let lastError:unknown;for(const provider of order){if(provider==='groq'&&!process.env.GROQ_API_KEY)continue;if(provider==='gemini'&&!process.env.GEMINI_API_KEY)continue;try{const r=provider==='groq'?await groq(system,prompt,image):await gemini(system,prompt,image);if(!r.text||typeof r.text!=='string')throw Error('Empty provider response');json(r.text);return {text:r.text,provider:r.provider};}catch(e){lastError=e;console.warn(`${provider} request failed:`,e instanceof Error?e.message:e);}}throw Error(lastError instanceof Error?`No AI provider succeeded: ${lastError.message}`:'No AI provider configured');}
export function shouldNotify(last:Record<string,any>|null,decision:{status:AdviceStatus;nextItem:string},screen:Screen):boolean{
 if(decision.status==='waiting')return false;
 if(!last||last.adviceStatus==='waiting')return true;
 // A missing subscription or failed gateway delivery must not permanently suppress retry.
 if(last.notificationQueued&&last.notification&&last.notification.delivered===0)return true;
 const priorType=last.screen==='draft'||last.screen==='loading'?'core':'next';
 const newType=screen==='draft'||screen==='loading'?'core':'next';
 return !sameItem(last.nextItem||'',decision.nextItem)||priorType!==newType;
}
export async function analyzeScreenshot(store:Store,token:string,bytes:Buffer,heroHint?:string):Promise<CoachResult>{
 const game=store.getGame(token);if(!game||game.status!=='active')throw Error('Active game not found');
 const image=await sharp(bytes,{limitInputPixels:20000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
 const roster=store.getRoster(token),slots=roster.slots.map(s=>`${s.side}[${s.position}]=${s.hero||'?'}${s.locked?' (MANUAL LOCK)':''}`).join(', ');
 const own=resolvePlayerHero(roster);
 const visionPrompt=`Known roster: ${slots}. Manually selected YOU slot: ${roster.youLocked?roster.you:'not locked'}. Trusted player hero: ${own||'unknown'}. Hero hint: ${heroHint||'none'}. Read ALL visible match-state signals and objective counters, do not guess. Use the trusted YOU slot for player-specific inventory and KDA extraction.`;
 const v=await invoke(VISION_SYSTEM,visionPrompt,image.toString('base64'));const vision=parseVision(v.text);
 const updated=store.applyRosterDetection(token,{heroes:vision.heroes,you:vision.you,screen:vision.screen});const playerHero=resolvePlayerHero(updated);
 let advice:Advice|null=null,adviceProvider='';
 if(playerHero&&vision.screen!=='unknown'){
  const enemy=updated.slots.slice(5).map(s=>s.hero||'Unknown'),allies=updated.slots.slice(0,5).map(s=>s.hero||'Unknown');
  const last=store.getLatestAnalysis(token);
  const prompt=`STAGE: ${vision.screen}. VERIFIED YOU HERO: ${playerHero}; ally position ${updated.you}. Allies: ${JSON.stringify(allies)}. Enemies: ${JSON.stringify(enemy)}. MATCH STATE (null=unknown): ${JSON.stringify(vision.matchState)}. Inventory readable: ${vision.inventoryReadable}; owned items: ${vision.inventoryReadable?JSON.stringify(vision.inventory):'UNKNOWN, not necessarily empty'}. Previous recommendation (for continuity, not authority): ${last?.nextItem||'none'}. Give a meaningful ${vision.screen==='scoreboard'?'NEXT purchase':'CORE build priority'} now. No requests for clearer screenshots. Explain one specific relevant threat or game-state consideration. Do not invent objective counts or item ownership.`;
  try{const r=await invoke(ADVICE_SYSTEM,prompt);advice=parseAdvice(r.text);adviceProvider=r.provider;}catch(e){console.warn('Item coaching failed:',e instanceof Error?e.message:e);}
 }
 const decision=decideAdvice(updated,vision,advice);const adviceType:CoachResult['adviceType']=decision.status==='waiting'?'none':vision.screen==='scoreboard'?'next':'core';
 const instruction=decision.status==='waiting'?`MLBB Coach: ${decision.reason}`.slice(0,350):`${adviceType==='core'?'CORE':'NEXT'}: ${decision.nextItem} - ${decision.reason}`.slice(0,350);
 const previous=store.latestInstruction(game)?.text;const last=store.getLatestAnalysis(token);
 const notificationQueued=shouldNotify(last,decision,vision.screen);
 // PiP is updated for EVERY successful analysis, even when no item advice is available.
 if(previous!==instruction)store.setInstruction(token,instruction);
 const result:CoachResult={screen:vision.screen,heroes:vision.heroes,you:updated.you,instruction,nextItem:decision.nextItem,reason:decision.reason,coreItems:advice?.coreItems||[],situationalItems:advice?.situationalItems||[],detectedHero:playerHero||'Unknown',confidence:decision.confidence,provider:adviceProvider?`${v.provider} (vision), ${adviceProvider} (coaching)`:v.provider,inventory:vision.inventory,inventoryReadable:vision.inventoryReadable,adviceStatus:decision.status,notificationQueued,matchState:vision.matchState,adviceType};
 store.saveLatestAnalysis(token,result);return result;
}
