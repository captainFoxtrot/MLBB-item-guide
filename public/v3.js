(()=>{'use strict';
const token=decodeURIComponent(location.pathname.split('/').pop());
let device=null;try{const d=JSON.parse(localStorage.getItem('mlbb-device-v21')||'null');if(d?.id&&d?.ownerKey&&d.gameToken===token)device=d;}catch{}
const $=id=>document.getElementById(id),levels=['weak','gaining','strong'];
let roster=null,threatState=null,suggestedCore=[],ratings={},allHeroes=[],busy=false,loaded=false,lastRevision=-1,dirty=false;
$('classicLink').href='/classic/'+encodeURIComponent(token);
async function api(path,method='GET',body){const headers={};if(device)headers.Authorization='Bearer '+device.ownerKey;if(body!==undefined)headers['Content-Type']='application/json';const res=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||`Request failed (${res.status})`);return data;}
function currentHero(){return roster?.you==null?null:roster.slots[roster.you]?.hero||null;}
function enemies(){return (roster?.slots||[]).slice(5).map(s=>s.hero).filter(Boolean);}
function labelStatus(text){$('sendStatus').textContent=text;}
function renderBoard(){
 const list=(roster?.slots||[]).slice(5),root=$('enemyBoard');root.replaceChildren();
 if(list.length!==5||list.some(s=>!s.hero)){const empty=document.createElement('div');empty.className='empty';empty.textContent='Loading screen: send one screenshot, or tap Edit draft to choose the five enemies.';root.append(empty);return;}
 list.forEach((slot,i)=>{
  const name=slot.hero,level=ratings[name]||null,card=document.createElement('div');card.className='enemy-card';card.dataset.level=level||'unmarked';
  const index=document.createElement('div');index.className='enemy-index';index.textContent=`ENEMY 0${i+1}`;card.append(index);
  const title=document.createElement('div');title.className='enemy-title';title.textContent=name;card.append(title);
  const group=document.createElement('div');group.className='rating-buttons';group.setAttribute('role','group');group.setAttribute('aria-label',`${name} threat level`);
  levels.forEach(state=>{const b=document.createElement('button');b.className='rating'+(level===state?' active':'');b.dataset.rating=state;b.textContent=state[0].toUpperCase()+state.slice(1);b.setAttribute('aria-pressed',String(level===state));b.onclick=()=>{ratings[name]=ratings[name]===state?null:state;dirty=true;renderBoard();renderSend();};group.append(b);});card.append(group);root.append(card);
 });
}
function renderSend(){const ready=!!device&&!!currentHero()&&enemies().length===5&&!busy;$('send').disabled=!ready;$('send').querySelector('span').textContent=busy?'Sending…':'Send update';}
function renderThreats(){
 const hero=currentHero();$('myHero').textContent=hero||'Select your hero';
 const core=threatState?.core?.length?threatState.core:suggestedCore;
 $('core').textContent=core.join(' · ')||'Awaiting hero selection';
 const owned=$('owned');owned.replaceChildren();const items=threatState?.assumed||[];
 if(items.length){items.forEach(i=>{const x=document.createElement('span');x.textContent=i;owned.append(x);});}
 else {const x=document.createElement('span');x.className='muted';x.textContent='Core assumed on first update';owned.append(x);}
 const pending=threatState?.pending;$('pending').textContent=pending?.item?`Next update assumes: ${pending.action==='SWAP'?`${pending.replace} → `:''}${pending.item}`:'';
 const last=threatState?.last;
 if(last){$('action').textContent=last.action;$('item').textContent=last.action==='SWAP'?`${last.replace} → ${last.item}`:last.item||'Keep current build';$('reason').textContent=last.reason;}
 renderSend();
}
async function refresh(force=false){try{
 const d=device?await api(`/api/devices/${device.id}`):await api(`/api/games/${token}`);
 $('connection').textContent='● Connected';$('connection').style.color='#63d2a4';
 if(!force&&loaded&&d.revision===lastRevision)return;
 loaded=true;lastRevision=d.revision;roster=d.roster;threatState=d.threats;suggestedCore=d.suggestedCore||[];
 if(!dirty){ratings={...(threatState?.ratings||{})};}renderBoard();renderThreats();
 }catch(e){$('connection').textContent='● Offline';$('connection').style.color='#f88a94';if(!loaded)labelStatus(e.message);}}
$('send').onclick=async()=>{if(busy||!device)return;busy=true;renderSend();labelStatus('Calculating the best counter…');try{
 const d=await api(`/api/devices/${device.id}/threats`,'POST',{ratings});threatState=d.threats;dirty=false;lastRevision=-1;
 const push=d.delivery;labelStatus(push.delivered?`✓ Push delivered (${push.delivered})`:push.enabled?`Saved, but push not delivered (${push.errors?.[0]||'check subscription'})`:'Saved · enable push in settings');
 renderThreats();
 }catch(e){labelStatus('Error: '+e.message);}finally{busy=false;renderSend();refresh(true);}};
function options(selected){return `<option value="">Select hero</option>`+allHeroes.map(h=>`<option value="${h.replaceAll('&','&amp;').replaceAll('"','&quot;')}"${h===selected?' selected':''}>${h.replaceAll('&','&amp;').replaceAll('<','&lt;')}</option>`).join('');}
$('editDraft').onclick=()=>{if(!device){labelStatus('This is a legacy session. Create a device from the home page to edit the draft.');return;}const hero=currentHero();$('heroSelect').innerHTML=options(hero);const root=$('enemySelects');root.replaceChildren();(roster?.slots||[]).slice(5).forEach((s,i)=>{const label=document.createElement('label');label.textContent=`ENEMY ${i+1}`;const select=document.createElement('select');select.dataset.slot=String(i+5);select.innerHTML=options(s.hero);label.append(select);root.append(label);});$('draftStatus').textContent='';$('draftDialog').showModal();};
$('saveDraft').onclick=async()=>{if(!device)return;const hero=$('heroSelect').value,chosen=[...$('enemySelects').querySelectorAll('select')].map(s=>s.value);if(!hero||chosen.some(x=>!x)||new Set(chosen).size!==5){$('draftStatus').textContent='Choose your hero and five different opponents.';return;}
 $('saveDraft').disabled=true;$('draftStatus').textContent='Saving lineup…';try{
  const allyIndex=roster?.you??0;
  await api(`/api/devices/${device.id}/roster`,'PATCH',{index:allyIndex,hero});
  await api(`/api/devices/${device.id}/roster`,'PATCH',{you:allyIndex});
  for(let i=0;i<5;i++)if(roster?.slots[i+5]?.hero!==chosen[i])await api(`/api/devices/${device.id}/roster`,'PATCH',{index:i+5,hero:chosen[i]});
  // A changed lineup invalidates the old build. Reset through New match for a fresh core.
  $('draftDialog').close();labelStatus('Draft saved. Send an update to get advice.');dirty=false;await refresh(true);
 }catch(e){$('draftStatus').textContent=e.message;}finally{$('saveDraft').disabled=false;}};
function drawInventoryEditor(){const root=$('inventoryEditor');root.replaceChildren();(threatState?.assumed||[]).forEach(item=>{const b=document.createElement('button');b.textContent='✕ '+item;b.onclick=async()=>{try{const d=await api(`/api/devices/${device.id}/inventory`,'PATCH',{action:'remove',item});threatState=d.threats;renderThreats();drawInventoryEditor();}catch(e){labelStatus(e.message);}};root.append(b);});if(!root.children.length)root.textContent='No assumed items yet.';}
$('editInventory').onclick=()=>{drawInventoryEditor();$('inventoryDialog').showModal();};
$('closeInventory').onclick=()=>$('inventoryDialog').close();
$('clearPending').onclick=async()=>{try{const d=await api(`/api/devices/${device.id}/inventory`,'PATCH',{action:'clear-pending'});threatState=d.threats;renderThreats();$('inventoryDialog').close();}catch(e){labelStatus(e.message);}};
$('openSettings').onclick=()=>{$('settingsDialog').showModal();};$('closeSettings').onclick=()=>$('settingsDialog').close();
function b64ToBytes(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function serviceWorker(){if(!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('Install this website to your iPhone Home Screen to enable push.');await navigator.serviceWorker.register('/sw.js');return navigator.serviceWorker.ready;}
$('enablePush').onclick=async()=>{try{const key=await api('/api/push/key');if(!key.enabled)throw Error('Server push keys not configured');const reg=await serviceWorker(),permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notification permission not granted');let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(key.publicKey)});await api(`/api/games/${token}/push`,'POST',{subscription:sub});$('pushStatus').textContent='Push enabled and subscribed.';}catch(e){$('pushStatus').textContent=e.message;}};
$('disablePush').onclick=async()=>{try{const reg=await serviceWorker(),sub=await reg.pushManager.getSubscription();if(sub){await api(`/api/games/${token}/push`,'DELETE',{endpoint:sub.endpoint});await sub.unsubscribe();}$('pushStatus').textContent='Push disabled.';}catch(e){$('pushStatus').textContent=e.message;}};
$('testPush').onclick=async()=>{try{const r=await api(`/api/devices/${device.id}/test-push`,'POST');$('pushStatus').textContent=`Test: ${r.delivery?.delivered||0} accepted / ${r.delivery?.attempted||0} attempted.`;}catch(e){$('pushStatus').textContent=e.message;}};
let latestCode='';$('pair').onclick=async()=>{try{const d=await api(`/api/devices/${device.id}/pair-code`,'POST');latestCode=d.code;$('pairCode').textContent=latestCode;$('pairCode').hidden=false;$('copyCode').hidden=false;$('pairStatus').textContent='Code valid for 10 minutes.';}catch(e){$('pairStatus').textContent=e.message;}};
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(latestCode);$('pairStatus').textContent='Code copied.';}catch(e){$('pairStatus').textContent=e.message;}};
$('newMatch').onclick=async()=>{if(!confirm('Start a new match? This clears the draft, threat ratings and assumed inventory.'))return;try{await api(`/api/devices/${device.id}/new`,'POST');ratings={};dirty=false;lastRevision=-1;await refresh(true);labelStatus('New match ready. Send a loading-screen screenshot or Edit draft.');}catch(e){labelStatus(e.message);}};
async function init(){try{const d=await api('/api/heroes');allHeroes=d.heroes||[];}catch{}
 if(!device){$('connection').textContent='Legacy session';labelStatus('Open the Home Screen app to use threat controls.');}
 await refresh(true);if(device){try{const d=await api(`/api/devices/${device.id}`);$('pairStatus').textContent=d.paired?'Screenshot Shortcut paired.':'Shortcut not paired. Use the pairing button below.';}catch{}
 try{if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager?.getSubscription();if(sub){await api(`/api/games/${token}/push`,'POST',{subscription:sub});$('pushStatus').textContent='Existing push subscription synced.';}}}catch{}}
 setInterval(()=>{if(!busy&&!dirty&&!document.querySelector('dialog[open]'))refresh();},4000);
}
init();
})();
