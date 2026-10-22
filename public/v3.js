(()=>{'use strict';
const token=decodeURIComponent(location.pathname.split('/').pop());
let device=null;try{const d=JSON.parse(localStorage.getItem('mlbb-device-v21')||'null');if(d?.id&&d?.ownerKey&&d.gameToken===token)device=d;}catch{}
const $=id=>document.getElementById(id),levels=['weak','gaining','strong'];
let roster=null,threatState=null,ratings={},strength='equal',allHeroes=[],busy=false,loaded=false,lastRevision=-1,dirty=false;
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
const strengths=[['far-ahead','Far ahead'],['ahead','Ahead'],['equal','Equal'],['behind','Behind'],['far-behind','Far behind']];
function renderStrength(){const root=$('strengthButtons');root.replaceChildren();for(const [id,label] of strengths){const b=document.createElement('button');b.className='strength-button'+(strength===id?' active':'');b.textContent=label;b.setAttribute('aria-pressed',String(strength===id));b.onclick=()=>{strength=id;dirty=true;renderStrength();};root.append(b);}}
function renderSend(){const ready=!!device&&!!currentHero()&&enemies().length===5&&!busy;$('send').disabled=!ready;$('send').querySelector('span').textContent=busy?'Updating…':'Update build';}
function itemIcon(name){const img=document.createElement('img');img.className='item-icon';img.alt='';img.loading='lazy';const slug=name.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');img.src='/item-icons/'+slug+'.png';img.onerror=()=>{if(!img.dataset.fallback){img.dataset.fallback='remote';img.src='https://raw.githubusercontent.com/Ceplin03/database-mlbb.Mobile-Legends-Bang-Bang/master/logo-equipment/'+slug+'.png';}else if(img.dataset.fallback==='remote'){img.dataset.fallback='placeholder';img.src='/item-placeholder.svg';}};return img;}
function renderRoute(){const root=$('buildRoute');root.replaceChildren();const route=threatState?.route;
 if(!route?.items?.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='Send an update to rank your eight recommended items.';root.append(empty);return;}
 route.items.forEach((entry,i)=>{const card=document.createElement('div');card.className='build-item'+(i>=6?' alternative':'');
 const number=document.createElement('span');number.className='build-number';number.textContent=i>=6?'ALT '+(i-5):String(i+1);card.append(number);
 card.append(itemIcon(entry.item));const copy=document.createElement('div');copy.className='build-copy';const name=document.createElement('strong');name.textContent=entry.item;copy.append(name);const reason=document.createElement('small');reason.textContent=entry.against?.length?'vs '+entry.against.join(', '):entry.kind==='core'?'Core power spike':entry.kind==='offense'?'Damage / utility':'Situational';copy.append(reason);card.append(copy);card.title=entry.reason;root.append(card);});
}
function renderThreats(){const hero=currentHero();$('myHero').textContent=hero||'Select your hero';const route=threatState?.route;
 if(route?.recommended?.length){$('action').textContent='TOP PRIORITY';$('item').textContent=route.recommended.slice(0,3).map(x=>x.item).join(' → ');$('reason').textContent=route.headline;}
 else {$('action').textContent='READY';$('item').textContent='Select threats';$('reason').textContent='Rank eight items based on the matchup and your relative strength.';}
 renderStrength();renderRoute();renderSend();
}
async function refresh(force=false){try{
 const d=device?await api(`/api/devices/${device.id}`):await api(`/api/games/${token}`);
 $('connection').textContent='● Connected';$('connection').style.color='#63d2a4';
 if(!force&&loaded&&d.revision===lastRevision)return;
 loaded=true;lastRevision=d.revision;roster=d.roster;threatState=d.threats;if(!dirty)strength=threatState?.strength||'equal';
 if(!dirty){ratings={...(threatState?.ratings||{})};}renderBoard();renderThreats();
 }catch(e){$('connection').textContent='● Offline';$('connection').style.color='#f88a94';if(!loaded)labelStatus(e.message);}}
$('send').onclick=async()=>{if(busy||!device)return;busy=true;renderSend();labelStatus('Optimizing your 8-item route…');try{
 const d=await api(`/api/devices/${device.id}/threats`,'POST',{ratings,strength});threatState=d.threats;dirty=false;lastRevision=-1;
 const push=d.delivery;labelStatus(!d.change?.notify?'Build updated · no major change, no push':push.delivered?`✓ Build updated · push delivered (${push.delivered})`:push.enabled?`Build updated · push not delivered (${push.errors?.[0]||'check subscription'})`:'Build updated · enable push in settings');
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
$('openSettings').onclick=()=>{$('settingsDialog').showModal();};$('closeSettings').onclick=()=>$('settingsDialog').close();
function b64ToBytes(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function serviceWorker(){if(!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('Install this website to your iPhone Home Screen to enable push.');await navigator.serviceWorker.register('/sw.js');return navigator.serviceWorker.ready;}
$('enablePush').onclick=async()=>{try{const key=await api('/api/push/key');if(!key.enabled)throw Error('Server push keys not configured');const reg=await serviceWorker(),permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notification permission not granted');let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(key.publicKey)});await api(`/api/games/${token}/push`,'POST',{subscription:sub});$('pushStatus').textContent='Push enabled and subscribed.';}catch(e){$('pushStatus').textContent=e.message;}};
$('disablePush').onclick=async()=>{try{const reg=await serviceWorker(),sub=await reg.pushManager.getSubscription();if(sub){await api(`/api/games/${token}/push`,'DELETE',{endpoint:sub.endpoint});await sub.unsubscribe();}$('pushStatus').textContent='Push disabled.';}catch(e){$('pushStatus').textContent=e.message;}};
$('testPush').onclick=async()=>{try{const r=await api(`/api/devices/${device.id}/test-push`,'POST');$('pushStatus').textContent=`Test: ${r.delivery?.delivered||0} accepted / ${r.delivery?.attempted||0} attempted.`;}catch(e){$('pushStatus').textContent=e.message;}};
let latestCode='';$('pair').onclick=async()=>{try{const d=await api(`/api/devices/${device.id}/pair-code`,'POST');latestCode=d.code;$('pairCode').textContent=latestCode;$('pairCode').hidden=false;$('copyCode').hidden=false;$('pairStatus').textContent='Code valid for 10 minutes.';}catch(e){$('pairStatus').textContent=e.message;}};
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(latestCode);$('pairStatus').textContent='Code copied.';}catch(e){$('pairStatus').textContent=e.message;}};
$('newMatch').onclick=async()=>{if(!confirm('Start a new match? This clears the draft, threat ratings and assumed inventory.'))return;try{await api(`/api/devices/${device.id}/new`,'POST');ratings={};strength='equal';dirty=false;lastRevision=-1;await refresh(true);labelStatus('New match ready. Send a loading-screen screenshot or Edit draft.');}catch(e){labelStatus(e.message);}};
async function init(){try{const d=await api('/api/heroes');allHeroes=d.heroes||[];}catch{}
 if(!device){$('connection').textContent='Legacy session';labelStatus('Open the Home Screen app to use threat controls.');}
 await refresh(true);if(device){try{const d=await api(`/api/devices/${device.id}`);$('pairStatus').textContent=d.paired?'Screenshot Shortcut paired.':'Shortcut not paired. Use the pairing button below.';}catch{}
 try{if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager?.getSubscription();if(sub){await api(`/api/games/${token}/push`,'POST',{subscription:sub});$('pushStatus').textContent='Existing push subscription synced.';}}}catch{}}
 setInterval(()=>{if(!busy&&!dirty&&!document.querySelector('dialog[open]'))refresh();},4000);
}
init();
})();
