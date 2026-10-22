import sharp from 'sharp';
import type { Store } from './db.js';
import type { Screen, Roster } from './roster.js';
import { normalizeHero } from './roster.js';

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
type Extracted = {vision:Vision;advice:Advice|null};
const WAITING='Select your hero';
const SYSTEM = `You are an MLBB screenshot reader AND tactical item coach. Return one compact JSON object only. The server supplies authoritative YOU and roster; NEVER override manual slots. Read the screenshot, do not guess invisible facts. Use null for unknown numeric values, [] for unreadable items. Do NOT copy another player's equipment into YOU inventory. Do NOT invent objective counts. A clock is MM:SS, never a gold number. If YOU hero is known, always recommend ONE legal, hero-appropriate item, even with unreadable inventory (provisional). Draft/loading: choose a CORE item based on team matchups. Scoreboard: choose a NEXT item based on visible gold, kills, threats, objectives and owned items. Never recommend an item clearly owned. Do not claim shield items grant stun immunity. The reason is 4-12 words. Prefer returning fewer VERIFIED fields over fabricated details. Return JSON keys: screen (draft/loading/scoreboard/unknown), heroes (only slots not already supplied; each {side,position,hero}), inventory (ONLY confirmed items belonging to YOU), inventoryReadable (true only if confident), confidence (low/medium/high), matchState (only fields you can read: time, kills:{ally,enemy}, gold:{ally,enemy}, towers:{ally,enemy}, turtles:{ally,enemy}, lords:{ally,enemy}, player:{level,kills,deaths,assists,gold}; omit uncertain fields), nextItem, reason, coreItems (max 3), situationalItems (max 2). Do not return long notes, duplicate hero lists or enemy item inventories.`;
const emptyMatchState=():MatchState=>({time:null,kills:{ally:null,enemy:null},gold:{ally:null,enemy:null},towers:{ally:null,enemy:null},turtles:{ally:null,enemy:null},lords:{ally:null,enemy:null},player:{level:null,kills:null,deaths:null,assists:null,gold:null},enemyItems:{},notes:[]});
function json(text:string):any {const v=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid provider JSON');return v;}
function strings(v:unknown,max=6):string[]{return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string').map(x=>x.trim().slice(0,80)).filter(Boolean).slice(0,max):[];}
function confidence(v:unknown):Confidence{return v==='high'||v==='medium'?v:'low';}
function n(v:unknown,max=1000000):number|null{return typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max?v:null;}
function pair(v:any,max:number){return {ally:n(v?.ally,max),enemy:n(v?.enemy,max)};}
export function normalizeMatchState(v:any):MatchState{
 const e=emptyMatchState(),p=v?.player||{};
 const time=typeof v?.time==='string'&&/^\d{1,2}:[0-5]\d$/.test(v.time)&&Number(v.time.split(':')[0])<=99?v.time:null;
 // Do not pass arbitrary notes or hallucinated enemy equipment to coaching.
 return {...e,time,kills:pair(v?.kills,200),gold:pair(v?.gold,1000000),towers:pair(v?.towers,20),turtles:pair(v?.turtles,20),lords:pair(v?.lords,20),player:{level:n(p.level,15),kills:n(p.kills,100),deaths:n(p.deaths,100),assists:n(p.assists,100),gold:n(p.gold,1000000)},enemyItems:{},notes:[]};
}
function parseVision(x:any):Vision{
 const heroes:Vision['heroes']=[];
 if(Array.isArray(x.heroes))for(const h of x.heroes){const hero=normalizeHero(h?.hero);if(h&&['ally','enemy'].includes(h.side)&&Number.isInteger(h.position)&&h.position>=0&&h.position<5&&hero&&!heroes.some(a=>a.side===h.side&&a.position===h.position))heroes.push({side:h.side,position:h.position,hero});}
 return {screen:['draft','loading','scoreboard','unknown'].includes(x.screen)?x.screen:'unknown',heroes,you:null,inventory:strings(x.inventory),inventoryReadable:x.inventoryReadable===true,confidence:confidence(x.confidence),matchState:normalizeMatchState(x.matchState)};
}
function parseAdvice(x:any):Advice|null{
 const nextItem=typeof x.nextItem==='string'?x.nextItem.trim().slice(0,100):'';
 if(!nextItem||/^(need clearer|unknown|none|n\/a|wait|coaching unavailable)/i.test(nextItem))return null;
 return {nextItem,reason:typeof x.reason==='string'?x.reason.trim().slice(0,140):'Enemy composition and match pressure',coreItems:strings(x.coreItems,3),situationalItems:strings(x.situationalItems,2),confidence:confidence(x.confidence)};
}
function sameItem(a:string,b:string){return a.toLowerCase().replace(/[^a-z0-9]/g,'')===b.toLowerCase().replace(/[^a-z0-9]/g,'');}
export function resolvePlayerHero(roster:Roster):string|null{return roster.you===null?null:roster.slots[roster.you]?.hero||null;}
export function decideAdvice(roster:Roster,vision:Vision,advice:Advice|null):{status:AdviceStatus;nextItem:string;reason:string;confidence:Confidence}{
 const hero=resolvePlayerHero(roster);
 if(!hero)return {status:'waiting',nextItem:WAITING,reason:'Select your ally slot using This is me.',confidence:'low'};
 if(vision.screen==='unknown')return {status:'waiting',nextItem:'Waiting for game screen',reason:'No recognizable draft, loading screen, or scoreboard.',confidence:'low'};
 const chosen=advice?.nextItem&&!/^(need clearer|unknown|none|n\/a|wait)/i.test(advice.nextItem)?advice.nextItem:advice?.coreItems.find(Boolean);
 if(!chosen)return {status:'waiting',nextItem:'Coaching unavailable',reason:'No verified item recommendation available.',confidence:'low'};
 if(vision.screen==='scoreboard'&&vision.inventoryReadable&&vision.inventory.some(item=>sameItem(item,chosen)))return {status:'waiting',nextItem:'Coaching unavailable',reason:'Suggested item is already owned; no duplicate purchase will be sent.',confidence:'low'};
 return {status:vision.screen==='scoreboard'&&vision.inventoryReadable?'actionable':'provisional',nextItem:chosen,reason:advice?.reason||'Team composition and match threats',confidence:vision.screen==='scoreboard'&&vision.inventoryReadable?advice?.confidence||'low':'low'};
}
// Local fallback is intentionally limited to verified hero-specific archetypes. No fabricated match metrics.
const GROUPS:Record<string,string[]>={
 basic:['Miya','Hanabi','Layla','Moskov','Melissa','Irithel','Bruno','Claude','Karrie','Wanwan','Ixia','Obsidia','Sun','Zilong','Freya','Argus','Aulus'],
 physical:['Granger','Clint','Brody','Beatrix','Lesley','Yi Sun-shin','Roger','Popol and Kupa','Suyou','Hayabusa','Ling','Fanny','Lancelot','Saber','Natalia','Helcurt','Nolan','Benedetta','Paquito','Alucard'],
 mage:['Pharsa','Eudora','Nana','Vale','Valir','Kadita','Kagura','Gord','Aurora','Vexana','Xavier','Novaria','Odette','Cecilion','Luo Yi','Yve','Zhask','Cyclops','Lunox','Harith','Harley','Gusion','Chang’e','Alice','Valentina','Zetian'],
 magicAssassin:['Karina','Aamon','Joy','Julian','Selena'],
 support:['Rafaela','Estes','Angela','Floryn','Mathilda','Diggie','Faramis','Kaja','Kalea'],
 tank:['Belerick','Minotaur','Tigreal','Atlas','Khufra','Gatotkaca','Hylos','Uranus','Grock','Lolita','Akai','Baxia','Fredrinn','Barats','Edith','Johnson','Franco','Carmilla','Chip','Gloo'],
 fighter:['Ruby','Terizla','Yu Zhong','Alpha','Thamuz','Dyrroth','Arlott','Cici','Lapu-Lapu','Martis','Leomord','X.Borg','Silvanna','Minsitthar','Balmond','Badang','Khaleed','Hilda','Masha','Chou','Yin','Jawhead','Aldous','Bane','Esmeralda','Phoveus','Guinevere','Lukas']
};
const PLANS:Record<string,[string,string,string]>={
 basic:['Corrosion Scythe','Demon Hunter Sword','Golden Staff'],physical:['Hunter Strike','Malefic Roar','Blade of Despair'],
 mage:['Glowing Wand','Holy Crystal','Divine Glaive'],magicAssassin:['Genius Wand','Holy Crystal','Divine Glaive'],
 support:['Flask of the Oasis','Dominance Ice','Immortality'],tank:['Dominance Ice','Athena’s Shield','Immortality'],
 fighter:['War Axe','Queen’s Wings','Malefic Roar']
};
export function fallbackAdvice(hero:string,enemyHeroes:string[],owned:string[],inventoryReadable:boolean,screen:Screen):Advice|null{
 const group=Object.keys(GROUPS).find(k=>GROUPS[k].includes(hero));if(!group)return null;
 const plan=PLANS[group],enemy=new Set(enemyHeroes);
 const healers=['Estes','Rafaela','Angela','Floryn','Alice','Uranus','Ruby'];
 const sustain=healers.some(h=>enemy.has(h));
 const antiheal=group==='basic'||group==='physical'?'Sea Halberd':group==='mage'||group==='magicAssassin'?'Glowing Wand':'Dominance Ice';
 const choices=screen==='scoreboard'&&sustain?[antiheal,...plan]:[...plan];
 const unique=[...new Set(choices)];
 const next=unique.find(i=>!inventoryReadable||!owned.some(o=>sameItem(i,o)));
 if(!next)return null;
 return {nextItem:next,reason:next===antiheal&&sustain?'Anti-heal against enemy sustain':'Provisional hero-specific build priority',coreItems:[...plan],situationalItems:sustain?[antiheal]:[],confidence:'low'};
}
// Cooldown on rate-limited providers; do not hammer Groq or wait 25s during live gameplay.
const providerCooldown=new Map<Provider,number>();
function cooldownMs(message:string){const match=message.match(/try again in\s+([\d.]+)s/i);return match?Math.min(120000,Math.max(1000,Number(match[1])*1000)):30000;}
async function api(url:string,headers:Record<string,string>,body:unknown){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:controller.signal});if(!res.ok)throw Error(`Provider HTTP ${res.status}: ${(await res.text()).slice(0,650)}`);return await res.json();}finally{clearTimeout(timeout);}}
async function groq(prompt:string,image:string){const key=process.env.GROQ_API_KEY;if(!key)throw Error('Groq key not configured');const model=process.env.GROQ_MODEL||'qwen/qwen3.8-27b';const out=await api('https://api.groq.com/openai/v1/chat/completions',{Authorization:`Bearer ${key}`},{model,temperature:0,max_completion_tokens:700,messages:[{role:'system',content:SYSTEM},{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${image}`}}]}]});return {text:out.choices?.[0]?.message?.content,provider:`groq:${model}`};}
async function gemini(prompt:string,image:string){const key=process.env.GEMINI_API_KEY;if(!key)throw Error('Gemini key not configured');const model=process.env.GEMINI_MODEL||'gemini-2.5-flash-lite';const out=await api(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{'x-goog-api-key':key},{systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:image}}]}],generationConfig:{temperature:0,maxOutputTokens:850,responseMimeType:'application/json'}});return {text:out.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join(''),provider:`gemini:${model}`};}
async function invoke(prompt:string,image:string):Promise<{extracted:Extracted;provider:string}>{
 const preferred=(process.env.AI_PRIMARY||'groq').toLowerCase()==='gemini'?'gemini':'groq';const order:Provider[]=preferred==='groq'?['groq','gemini']:['gemini','groq'];let lastError:unknown;
 for(const provider of order){if(provider==='groq'&&!process.env.GROQ_API_KEY)continue;if(provider==='gemini'&&!process.env.GEMINI_API_KEY)continue;if((providerCooldown.get(provider)||0)>Date.now())continue;
  try{const r=provider==='groq'?await groq(prompt,image):await gemini(prompt,image);if(!r.text||typeof r.text!=='string')throw Error('Empty provider response');const x=json(r.text);return {extracted:{vision:parseVision(x),advice:parseAdvice(x)},provider:r.provider};}
  catch(e){lastError=e;const message=e instanceof Error?e.message:String(e);if(/Provider HTTP 429/.test(message))providerCooldown.set(provider,Date.now()+cooldownMs(message));console.warn(`${provider} request failed:`,message.slice(0,400));}
 }
 throw Error(lastError instanceof Error?`No AI provider succeeded: ${lastError.message}`:'AI provider unavailable or cooling down');
}
export function shouldNotify(last:Record<string,any>|null,decision:{status:AdviceStatus;nextItem:string},screen:Screen):boolean{
 if(decision.status==='waiting')return false;
 if(!last||last.adviceStatus==='waiting')return true;
 if(last.notificationQueued&&last.notification&&last.notification.delivered===0)return true;
 const priorType=last.screen==='draft'||last.screen==='loading'?'core':'next';
 const newType=screen==='draft'||screen==='loading'?'core':'next';
 return !sameItem(last.nextItem||'',decision.nextItem)||priorType!==newType;
}
export async function analyzeScreenshot(store:Store,token:string,bytes:Buffer,heroHint?:string):Promise<CoachResult>{
 const game=store.getGame(token);if(!game||game.status!=='active')throw Error('Active game not found');
 const image=await sharp(bytes,{limitInputPixels:20000000}).rotate().resize({width:1440,height:1440,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
 const roster=store.getRoster(token),slots=roster.slots.map(s=>`${s.side[0]}${s.position}:${s.hero||'?'}${s.locked?'!':''}`).join(' ');
 const own=resolvePlayerHero(roster);
 const prompt=`Roster ${slots}. YOU ally slot=${roster.you??'unknown'}, hero=${own||'unknown'}; manual YOU=${roster.youLocked}. Hint=${heroHint||'none'}. Return only compact verified JSON. If YOU is unknown, omit item advice. Prefer null to guessed scores. The hero list should contain only unknown or corrected unlocked slots.`;
 let extracted:Extracted={vision:{screen:'unknown',heroes:[],you:null,inventory:[],inventoryReadable:false,confidence:'low',matchState:emptyMatchState()},advice:null};let provider='local:fallback';
 try{const response=await invoke(prompt,image.toString('base64'));extracted=response.extracted;provider=response.provider;}
 catch(e){console.warn('Screenshot AI unavailable:',e instanceof Error?e.message:e);}
 const vision=extracted.vision;
 // If provider is unavailable, retain last known screen instead of manufacturing a new classification.
 if(vision.screen==='unknown'&&provider==='local:fallback'&&roster.screen!=='unknown')vision.screen=roster.screen;
 const updated=store.applyRosterDetection(token,{heroes:vision.heroes,you:vision.you,screen:vision.screen});const playerHero=resolvePlayerHero(updated);
 const enemies=updated.slots.slice(5).map(s=>s.hero||'');
 // Reject cross-role equipment lists rather than treating obviously misattributed rows as verified.
 const role=Object.keys(GROUPS).find(k=>GROUPS[k].includes(playerHero||''));
 const magicOnly=['Holy Crystal','Glowing Wand','Divine Glaive','Genius Wand','Blood Wings','Winter Truncheon'];
 const physicalOnly=['Blade of Despair','Wind of Nature','Corrosion Scythe','Demon Hunter Sword','Golden Staff'];
 if((role==='basic'||role==='physical'||role==='fighter')&&vision.inventory.some(i=>magicOnly.some(j=>sameItem(i,j))) ||
    (role==='mage'||role==='magicAssassin')&&vision.inventory.some(i=>physicalOnly.some(j=>sameItem(i,j)))){
   vision.inventory=[];vision.inventoryReadable=false;
 }
 let advice=extracted.advice;
 if(playerHero&&vision.screen!=='unknown'){
  if(advice&&vision.inventoryReadable&&vision.inventory.some(i=>sameItem(i,advice!.nextItem)))advice=null;
  if(!advice){advice=fallbackAdvice(playerHero,enemies,vision.inventory,vision.inventoryReadable,vision.screen);if(advice)provider=`${provider} + local:provisional`;}
 }
 const decision=decideAdvice(updated,vision,advice);
 // Local heuristic recommendations are always provisional, regardless of inventory extraction.
 if(provider.includes('local:provisional')&&decision.status==='actionable'){decision.status='provisional';decision.confidence='low';}
 const adviceType:CoachResult['adviceType']=decision.status==='waiting'?'none':vision.screen==='scoreboard'?'next':'core';
 const instruction=decision.status==='waiting'?`MLBB Coach: ${decision.reason}`.slice(0,350):`${adviceType==='core'?'CORE':'NEXT'}: ${decision.nextItem} - ${decision.reason}`.slice(0,350);
 const previous=store.latestInstruction(game)?.text,last=store.getLatestAnalysis(token);
 const notificationQueued=shouldNotify(last,decision,vision.screen);
 if(previous!==instruction)store.setInstruction(token,instruction);
 const result:CoachResult={screen:vision.screen,heroes:vision.heroes,you:updated.you,instruction,nextItem:decision.nextItem,reason:decision.reason,coreItems:advice?.coreItems||[],situationalItems:advice?.situationalItems||[],detectedHero:playerHero||'Unknown',confidence:decision.confidence,provider,inventory:vision.inventory,inventoryReadable:vision.inventoryReadable,adviceStatus:decision.status,notificationQueued,matchState:vision.matchState,adviceType};
 store.saveLatestAnalysis(token,result);return result;
}
