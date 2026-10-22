import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './db.js';
import { createMcp } from './mcp.js';
import { createStreamManager } from './stream.js';
import { analyzeScreenshot } from './coach.js';
import { createPush } from './push.js';
import { HEROES } from './roster.js';
import { authorizeOwner } from './device.js';
import { candidates, enemyFromRoster, heroFromRoster, initialCore, type Rating } from './threat-coach.js';
import { buildRoute, routeChange, isStrength, type Strength, type RouteItem } from './build-route.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const store=createStore(process.env.DB_FILE||'./data/mlbb-coach.sqlite');
const streams=createStreamManager(store);
const push=createPush(store);
const analyses=new Map<string,number>();
const threatRequests=new Set<string>();
async function publishAdvice(token:string,result:Awaited<ReturnType<typeof analyzeScreenshot>>){
  // Loading-screen screenshots establish a baseline core, not an assumed purchase.
  // Threat-button updates later handle all adaptive NEXT/SWAP/KEEP decisions.
  const hero=heroFromRoster(store.getRoster(token));
  if(hero&&(result.screen==='draft'||result.screen==='loading')){
    const core=initialCore(hero);
    const instruction=`CORE: ${core.join(' > ')} — baseline; adapt with threat ratings`;
    const previous=store.latestInstruction(store.getGame(token)!)?.text;
    result.coreItems=core;result.nextItem=core[0];result.reason='Baseline core; mark enemy threats after completing it';
    result.adviceType='core';result.adviceStatus='provisional';result.instruction=instruction;
    result.notificationQueued=previous!==instruction;
    if(previous!==instruction)store.setInstruction(token,instruction);
  }
  if(result.notificationQueued){
    const title=result.adviceType==='core'?'MLBB Coach · Core':'MLBB Coach · Next item';
    result.notification=await push.notify(token,title,`${result.nextItem} - ${result.reason}`);
  }else{
    result.notification={enabled:push.enabled,attempted:0,delivered:0,failed:0,expired:0,errors:[]};
  }
  store.saveLatestAnalysis(token,result);
  return result;
}
const app=Fastify({logger:true, bodyLimit: 10*1024*1024});
await app.register(staticPlugin,{root:join(root,'public'),prefix:'/'});
const created=new Map<string,{count:number,until:number}>();
function checkCreation(ip:string){ const now=Date.now();const prev=created.get(ip);if(!prev||now>prev.until){created.set(ip,{count:1,until:now+3600000});return true;}prev.count++;return prev.count<=15; }

// v2.1: browser owns a device, while the iPhone Shortcut holds a separate capture credential.
app.get('/api/heroes',async()=>({heroes:HEROES}));
app.get('/api/setup',async()=>({shortcutInstallUrl:process.env.SHORTCUT_INSTALL_URL||null}));
app.post('/api/devices',async(req,reply)=>{
 if(!checkCreation(req.ip))return reply.code(429).send({error:'Too many devices created'});
 const d=store.createDevice();reply.header('Cache-Control','no-store');return d;
});
function owner(req:any,reply:any){const d=authorizeOwner(store,req.params.id,req.headers.authorization);if(!d){reply.code(401).send({error:'Device owner authentication required'});return null;}return d;}
app.get<{Params:{id:string}}>('/api/devices/:id',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 const game=store.getGame(d.game_token)!;const latest=store.latestInstruction(game);
 reply.header('Cache-Control','no-store');
 return {id:d.id,paired:!!d.capture_hash,gameToken:game.token,status:game.status,revision:game.revision,instruction:latest?.text||null,roster:store.getRoster(game.token),analysis:store.getLatestAnalysis(game.token),threats:store.getThreatState(game.token),suggestedCore:heroFromRoster(store.getRoster(game.token))?initialCore(heroFromRoster(store.getRoster(game.token))!):[]};
});
app.post<{Params:{id:string}}>('/api/devices/:id/pair-code',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 reply.header('Cache-Control','no-store');return store.newPairingCode(d.id);
});
app.post<{Body:{code:string}}>('/api/devices/claim',async(req,reply)=>{
 const code=req.body?.code;
 if(typeof code!=='string')return reply.code(400).send({error:'Pairing code required'});
 const result=store.claimPairingCode(code);
 if(!result)return reply.code(401).send({error:'Pairing code expired or invalid'});
 reply.header('Cache-Control','no-store');return result;
});
app.delete<{Params:{id:string}}>('/api/devices/:id/pair',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 store.revokeCapture(d.id);return {ok:true};
});
app.post<{Params:{id:string}}>('/api/devices/:id/new',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 const game=store.newRound(d.game_token);return {gameToken:game.token,revision:game.revision};
});
app.patch<{Params:{id:string};Body:{index?:number;hero?:string|null;you?:number|null}}>('/api/devices/:id/roster',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 const body=req.body;
 if(!body||typeof body!=='object'||(!Object.hasOwn(body,'index')&&!Object.hasOwn(body,'you')))return reply.code(400).send({error:'index or you required'});
 try{return {roster:store.updateRosterManual(d.game_token,body)};}
 catch(e){return reply.code(400).send({error:e instanceof Error?e.message:'Invalid roster'});}
});
// v3.1: full eight-item route; no inferred purchases from repeated threat updates.
app.post<{Params:{id:string};Body:{ratings?:Record<string,Rating>;strength?:Strength}}>('/api/devices/:id/threats',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 const token=d.game_token,roster=store.getRoster(token),hero=heroFromRoster(roster);
 if(!hero)return reply.code(409).send({error:'Select your hero in Edit draft first'});
 const enemies=roster.slots.slice(5).map(s=>s.hero).filter((s):s is string=>!!s);
 if(enemies.length!==5)return reply.code(409).send({error:'Identify all five enemies first'});
 const ratings=req.body?.ratings,strength=req.body?.strength??'equal';
 if(!ratings||typeof ratings!=='object'||Array.isArray(ratings))return reply.code(400).send({error:'Threat ratings required'});
 if(!isStrength(strength))return reply.code(400).send({error:'Invalid relative strength'});
 if(Object.keys(ratings).some(h=>!enemies.includes(h)||![null,'weak','gaining','strong'].includes(ratings[h])))return reply.code(400).send({error:'Invalid hero or rating'});
 if(threatRequests.has(token))return reply.code(409).send({error:'Recommendation already processing'});
 threatRequests.add(token);
 try{
  const state=store.getThreatState(token);
  const previous=(state as any).route?.items as RouteItem[]|undefined;
  state.ratings=Object.fromEntries(enemies.map(h=>[h,ratings[h]||null]));
  state.core=initialCore(hero);state.initialized=true;
  state.assumed=[];state.pending=null;state.last=null;
  const route=buildRoute(hero,enemyFromRoster(roster,state.ratings),strength);
  const change=routeChange(previous,route);
  (state as any).route=route;
  (state as any).strength=strength;
  const instruction=`BUILD: ${route.recommended.map(x=>x.item).join(' > ')} | ALT: ${route.alternatives.map(x=>x.item).join(', ')}`;
  store.setInstruction(token,instruction.slice(0,750));
  store.saveThreatState(token,state);
  const delivery=change.notify?await push.notify(token,change.title,change.body.slice(0,220)):{enabled:push.enabled,attempted:0,delivered:0,failed:0,expired:0,errors:[]};
  return {ok:true,hero,route,change,delivery,threats:state};
 }catch(e){req.log.error(e);return reply.code(500).send({error:e instanceof Error?e.message:'Coaching failed'});}
 finally{threatRequests.delete(token);}
});
app.patch<{Params:{id:string};Body:{action:'add'|'remove'|'clear-pending';item?:string}}>('/api/devices/:id/inventory',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 const state=store.getThreatState(d.game_token),body=req.body;
 if(!body||!['add','remove','clear-pending'].includes(body.action))return reply.code(400).send({error:'Invalid action'});
 if(body.action==='clear-pending')state.pending=null;
 else{
  const item=body.item;
  const roster=store.getRoster(d.game_token),hero=heroFromRoster(roster);
  if(!hero)return reply.code(409).send({error:'Select your hero first'});
  const valid=new Set([...initialCore(hero),...candidates(hero,enemyFromRoster(roster,state.ratings)).map(c=>c.item),...(state.pending?.item?[state.pending.item]:[])]);
  if(!item||!valid.has(item))return reply.code(400).send({error:'Unknown item'});
  if(body.action==='remove'){state.assumed=state.assumed.filter(i=>i!==item);if(state.pending?.item===item)state.pending=null;}
  if(body.action==='add'&&!state.assumed.includes(item)){if(state.assumed.length>=6)return reply.code(409).send({error:'Inventory full: remove an item first'});state.assumed.push(item);}
 }
 store.saveThreatState(d.game_token,state);return {ok:true,threats:state};
});
// Device capture is independent of a match token. The server resolves the current match.
app.post<{Body:Buffer;Headers:{authorization?:string;'x-hero-hint'?:string}}>('/api/devices/capture',async(req,reply)=>{
 const key=req.headers.authorization?.replace(/^Bearer\s+/i,'');
 const device=key?store.getDeviceByCapture(key):undefined;
 if(!device)return reply.code(401).send({error:'Device pairing required'});
 const token=device.game_token;const game=store.getGame(token);
 if(!game||game.status!=='active')return reply.code(409).send({error:'No active match'});
 if(!Buffer.isBuffer(req.body)||req.body.length<1000)return reply.code(400).send({error:'Upload raw PNG/JPEG image'});
 const last=analyses.get(token)||0;if(Date.now()-last<12000)return reply.code(429).send({error:'Wait 12 seconds between analyses'});
 analyses.set(token,Date.now());
 try{const result=await analyzeScreenshot(store,token,req.body,req.headers['x-hero-hint']);
   return await publishAdvice(token,result);
 }catch(err){req.log.error(err);return reply.code(502).send({error:err instanceof Error?err.message:'AI analysis failed'});}
});
app.post('/api/games',async(req,reply)=>{
  if(!checkCreation(req.ip))return reply.code(429).send({error:'Too many new sessions; retry later'});
  const game=store.createGame();
  store.setInstruction(game.token,'Waiting for draft screenshot and hero selection.');
  return {token:game.token,message:`Use this token: ${game.token} to start the MLBB Item Coach Skill, to guide my game. I will give you instructions when hero selection is completed.`, url:`/game/${game.token}`};
});
app.get<{Params:{token:string}}>('/api/games/:token',async(req,reply)=>{
  const game=store.getGame(req.params.token);if(!game)return reply.code(404).send({error:'Unknown token'});
  reply.header('Cache-Control','no-store');
  const latest=store.latestInstruction(game);
  return {token:game.token,status:game.status,revision:game.revision,instruction:latest?.text??null,updatedAt:latest?.created_at??game.updated_at,roster:store.getRoster(game.token),analysis:store.getLatestAnalysis(game.token),threats:store.getThreatState(game.token),suggestedCore:heroFromRoster(store.getRoster(game.token))?initialCore(heroFromRoster(store.getRoster(game.token))!):[]};
});
app.get('/api/push/key',async()=>({publicKey:push.publicKey,enabled:push.enabled}));
app.get<{Params:{id:string}}>('/api/devices/:id/push-status',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 const subs=store.getSubscriptions(d.game_token);
 return {enabled:push.enabled,subscriptions:subs.length,lastDelivery:store.getLatestAnalysis(d.game_token)?.notification||null};
});
app.post<{Params:{id:string}}>('/api/devices/:id/test-push',async(req,reply)=>{
 const d=owner(req,reply);if(!d)return;
 const delivery=await push.notify(d.game_token,'MLBB Coach · Test','Test notification delivered successfully.');
 return {ok:delivery.delivered>0,delivery};
});
app.post<{Params:{token:string};Body:{subscription:{endpoint:string;keys:{p256dh:string;auth:string}}}}>('/api/games/:token/push',async(req,reply)=>{
  if(!push.enabled)return reply.code(503).send({error:'Push not configured'});
  const sub=req.body?.subscription;
  if(!sub||typeof sub.endpoint!=='string'||!sub.endpoint.startsWith('https://')||!sub.keys?.p256dh||!sub.keys?.auth)return reply.code(400).send({error:'Invalid subscription'});
  try{store.addSubscription(req.params.token,sub);return {ok:true};}catch{return reply.code(404).send({error:'Unknown token'});}
});
app.delete<{Params:{token:string};Body:{endpoint:string}}>('/api/games/:token/push',async(req,reply)=>{
  if(!store.getGame(req.params.token))return reply.code(404).send({error:'Unknown token'});
  const endpoint=req.body?.endpoint;
  if(typeof endpoint!=='string'||!store.getSubscriptions(req.params.token).some(s=>s.endpoint===endpoint))return reply.code(404).send({error:'Subscription not found'});
  store.deleteSubscription(endpoint);return {ok:true};
});
// iOS Shortcut: Get Contents of URL, POST raw JPEG/PNG bytes, X-MLBB-Token header.
app.addContentTypeParser(['image/jpeg','image/png','image/webp','application/octet-stream'],{parseAs:'buffer',bodyLimit:10*1024*1024},(_req,body,done)=>done(null,body));
app.post<{Params:{token:string};Body:Buffer;Headers:{'x-mlbb-token'?:string;'x-hero-hint'?:string}}>('/api/games/:token/analyze',async(req,reply)=>{
  const token=req.params.token.toUpperCase();
  if(req.headers['x-mlbb-token']!==token)return reply.code(401).send({error:'Session token header required'});
  const game=store.getGame(token);if(!game||game.status!=='active')return reply.code(404).send({error:'Active game not found'});
  if(!Buffer.isBuffer(req.body)||req.body.length<1000)return reply.code(400).send({error:'Upload screenshot bytes as JPEG or PNG'});
  const last=analyses.get(token)||0;if(Date.now()-last<12000)return reply.code(429).send({error:'Wait 12 seconds between analyses'});
  analyses.set(token,Date.now());
  try{const result=await analyzeScreenshot(store,token,req.body,req.headers['x-hero-hint']);return await publishAdvice(token,result);}
  catch(err){req.log.error(err);return reply.code(502).send({error:err instanceof Error?err.message:'AI analysis failed'});}
});
app.post<{Params:{token:string}}>('/api/games/:token/new' ,async(req,reply)=>{
  try {const game=store.newRound(req.params.token);return {status:game.status,revision:game.revision};}
  catch{return reply.code(404).send({error:'Unknown token'});}
});
app.get<{Params:{token:string}}>('/classic/:token',async(req,reply)=>{if(!store.getGame(req.params.token))return reply.code(404).send('Unknown token');return reply.sendFile('classic.html');});
app.get<{Params:{token:string}}>('/game/:token',async(req,reply)=>{
  if(!store.getGame(req.params.token))return reply.code(404).send('Unknown token');
  return reply.sendFile('game.html');
});
app.get<{Params:{token:string,filename:string}}>('/api/games/:token/hls/:filename',async(req,reply)=>{
  if(!store.getGame(req.params.token))return reply.code(404).send('Unknown token');
  if(!/^(index\.m3u8|part\d{6}\.ts)$/.test(req.params.filename))return reply.code(400).send('Invalid filename');
  const dir=streams.start(req.params.token);if(!dir)return reply.code(404).send('Unknown token');
  const path=join(dir,req.params.filename);
  try {
    // Playlist requires a moment to be produced when first requested.
    let success=false;
    for(let i=0;i<15;i++){
      try {await stat(path);success=true;break;}catch{await new Promise(r=>setTimeout(r,250));}
    }
    if(!success)return reply.code(503).header('Retry-After','1').send('Stream warming up');
    const body=await readFile(path);
    reply.header('Cache-Control','no-store, no-cache, must-revalidate');
    reply.header('Content-Type',req.params.filename.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t');
    return reply.send(body);
  }catch {return reply.code(404).send('Segment unavailable');}
});
const apiKey=process.env.MCP_API_KEY;
app.route({method:['GET','POST','DELETE'],url:'/mcp',handler:async(req,reply)=>{
  if(apiKey&&req.headers.authorization!==`Bearer ${apiKey}`)return reply.code(401).send({error:'MCP authentication required'});
  // Forward Fastify's raw request/response to the official transport.
  // Fastify has already parsed JSON, so provide req.body for POST.
  const {server,transport}=createMcp(store);
  try {
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw,reply.raw,req.method==='POST'?req.body:undefined);
  } catch(err) {
    req.log.error(err);
    if(!reply.raw.headersSent){reply.raw.statusCode=500;reply.raw.end('MCP request failed');}
  } finally {await transport.close();await server.close();}
}});
app.get('/health',async()=>({ok:true}));
app.addHook('onClose',async()=>{streams.close();store.db.close();});
const port=Number(process.env.PORT||3000);const host=process.env.HOST||'127.0.0.1';
await app.listen({port,host});
