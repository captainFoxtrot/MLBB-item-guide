(() => {
'use strict';
const saved=JSON.parse(localStorage.getItem('mlbb-device-v21')||'null');
const device=saved?.id&&saved?.ownerKey&&saved?.gameToken===decodeURIComponent(location.pathname.split('/').pop())?saved:null;
const pairSection=document.getElementById('pairSection');
const dialog=document.getElementById('heroDialog'),search=document.getElementById('heroSearch'),choices=document.getElementById('heroChoices');
let heroes=[],roster=null,editing=-1,latestCode='';
const auth=()=>({'Authorization':'Bearer '+device.ownerKey,'Content-Type':'application/json'});
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...auth(),...(opts.headers||{})}}),v=await r.json();if(!r.ok)throw Error(v.error||'Request failed');return v;}
const slotNode=(slot,i)=>{
 const node=document.createElement('div');node.className='hero-slot'+(roster.you===i?' is-you':'');
 const top=document.createElement('div');top.className='slot-top';
 const label=document.createElement('span');label.className='position';label.textContent=`${slot.side==='ally'?'ALLY':'ENEMY'} ${slot.position+1}`;top.append(label);
 if(roster.you===i){const you=document.createElement('span');you.className='you-badge';you.textContent='YOU';top.append(you);}node.append(top);
 const name=document.createElement('button');name.className='hero-name'+(!slot.hero?' empty':'');name.textContent=slot.hero||'+ Select hero';name.onclick=()=>openEditor(i);node.append(name);
 const bottom=document.createElement('div');bottom.className='slot-bottom';
 const source=document.createElement('span');source.className='source';source.textContent=slot.source==='manual'?'Manual ✓':slot.source==='ai'?'AI detected':'Not detected';bottom.append(source);
 if(i<5){const me=document.createElement('button');me.className='me-toggle'+(roster.you===i?' active':'');me.textContent=roster.you===i?'✓ This is me':'This is me';me.onclick=()=>save({you:i});bottom.append(me);}node.append(bottom);return node;
};
window.renderRoster=(r)=>{if(!r||dialog.open)return;roster=r;document.getElementById('screenStage').textContent=`Screen: ${r.screen||'unknown'}`;for(const [id,slots] of [['allies',r.slots.slice(0,5)],['enemies',r.slots.slice(5)]]){const root=document.getElementById(id);root.replaceChildren(...slots.map((s,j)=>slotNode(s,id==='allies'?j:j+5)));}};
window.resetRoster=()=>{roster=null;};
async function save(change){if(!device){document.getElementById('rosterStatus').textContent='Open a v2.1 device session to edit heroes.';return;}
 try{const v=await api(`/api/devices/${device.id}/roster`,{method:'PATCH',body:JSON.stringify(change)});dialog.close();window.renderRoster(v.roster);document.getElementById('rosterStatus').textContent='Saved. AI will not overwrite manually corrected heroes.';}catch(e){document.getElementById('rosterStatus').textContent=e.message;}}
function openEditor(index){editing=index;document.getElementById('editLabel').textContent=`${index<5?'Ally':'Enemy'} ${index%5+1} — Select hero`;search.value='';dialog.showModal();search.focus();drawChoices();}
function drawChoices(){const q=search.value.trim().toLowerCase();choices.replaceChildren(...heroes.filter(h=>h.toLowerCase().includes(q)).slice(0,40).map(h=>{const b=document.createElement('button');b.type='button';b.textContent=h;b.onclick=()=>save({index:editing,hero:h});return b;}));}
search.oninput=drawChoices;document.getElementById('clearHero').onclick=()=>save({index:editing,hero:null});
fetch('/api/heroes').then(r=>r.json()).then(v=>{heroes=v.heroes||[];}).catch(()=>{});
if(!device){pairSection.hidden=true;document.getElementById('rosterStatus').textContent='This is a legacy match. New sessions from the Home Screen support manual hero editing.';return;}
pairSection.hidden=false;
async function refreshDevice(){try{const v=await api(`/api/devices/${device.id}`);document.getElementById('pairStatus').textContent=v.paired?'Shortcut paired ✓ — screenshots will reach this match.':'Shortcut not paired yet.';window.renderRoster(v.roster);}catch(e){document.getElementById('pairStatus').textContent=e.message;}}
refreshDevice();setInterval(refreshDevice,5000);
document.getElementById('pair').onclick=async()=>{try{const v=await api(`/api/devices/${device.id}/pair-code`,{method:'POST'});latestCode=v.code;document.getElementById('pairCode').textContent=v.code;document.getElementById('pairCode').hidden=false;document.getElementById('copyCode').hidden=false;document.getElementById('pairStatus').textContent='One-time code, valid for 10 minutes. Run the Shortcut pairing setup now.';}catch(e){document.getElementById('pairStatus').textContent=e.message;}};
document.getElementById('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(latestCode);document.getElementById('pairStatus').textContent='Pairing code copied.';}catch(e){document.getElementById('pairStatus').textContent=e.message;}};
document.getElementById('unpair').onclick=async()=>{if(!confirm('Disconnect your Shortcut? Screenshots will stop working until paired again.'))return;try{await api(`/api/devices/${device.id}/pair`,{method:'DELETE'});latestCode='';document.getElementById('pairCode').hidden=true;document.getElementById('pairStatus').textContent='Shortcut disconnected.';}catch(e){document.getElementById('pairStatus').textContent=e.message;}};
fetch('/api/setup').then(r=>r.json()).then(v=>{if(v.shortcutInstallUrl&&/^https:\/\//.test(v.shortcutInstallUrl)){const a=document.getElementById('shortcutInstall');a.href=v.shortcutInstallUrl;a.hidden=false;}}).catch(()=>{});
})();
