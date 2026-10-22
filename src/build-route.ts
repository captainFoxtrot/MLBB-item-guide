import { heroGroup, initialCore, type Rating } from './threat-coach.js';
export type Strength='far-ahead'|'ahead'|'equal'|'behind'|'far-behind';
export type RouteItem={item:string;reason:string;against:string[];kind:'core'|'offense'|'counter'|'defense';score:number};
export type Route={items:RouteItem[];recommended:RouteItem[];alternatives:RouteItem[];strength:Strength;headline:string};
const validStrengths:Strength[]=['far-ahead','ahead','equal','behind','far-behind'];
export function isStrength(s:unknown):s is Strength{return validStrengths.includes(s as Strength);}
const pools:Record<string,string[]>={
 basic:['Golden Staff','Malefic Roar','Sea Halberd','Wind of Nature','Rose Gold Meteor','Immortality','Haas\'s Claws','Malefic Gun','Blade of Despair'],
 physical:['Malefic Roar','Blade of Despair','Sea Halberd','Rose Gold Meteor','Wind of Nature','Immortality','Endless Battle','Antique Cuirass','Hunter Strike'],
 mage:['Divine Glaive','Blood Wings','Glowing Wand','Winter Crown','Athena\'s Shield','Immortality','Wishing Lantern','Concentrated Energy','Lightning Truncheon'],
 magicAssassin:['Divine Glaive','Blood Wings','Glowing Wand','Winter Crown','Athena\'s Shield','Immortality','Concentrated Energy','Starlium Scythe','Sky Piercer'],
 support:['Immortality','Oracle','Glowing Wand','Athena\'s Shield','Antique Cuirass','Dominance Ice','Radiant Armor','Winter Crown'],
 tank:['Immortality','Oracle','Radiant Armor','Antique Cuirass','Blade Armor','Cursed Helmet','Guardian Helmet','Twilight Armor'],
 fighter:['Malefic Roar','Immortality','Sea Halberd','Rose Gold Meteor','Antique Cuirass','Blade of Despair','Oracle','Dominance Ice','Hunter Strike']
};
const magicBurst=new Set(['Karina','Eudora','Kadita','Gusion','Aamon','Aurora','Harley','Lunox','Kagura','Selena','Pharsa','Vale','Nana','Novaria','Xavier','Vexana','Zetian']);
const physicalDamage=new Set(['Saber','Hayabusa','Fanny','Ling','Lancelot','Nolan','Natalia','Helcurt','Brody','Lesley','Clint','Hanabi','Miya','Moskov','Layla','Bruno','Melissa','Claude','Karrie','Wanwan','Irithel','Ixia','Granger','Roger','Alucard']);
const sustain=new Set(['Estes','Rafaela','Floryn','Angela','Alice','Ruby','Uranus','Esmeralda','Yu Zhong','Thamuz','Alucard']);
const tanks=new Set(['Tigreal','Atlas','Belerick','Hylos','Gatotkaca','Uranus','Fredrinn','Barats','Grock','Minotaur','Akai','Khufra','Baxia','Johnson']);
const groupOffense:Record<string,string[]>={
 basic:['Golden Staff','Malefic Roar','Malefic Gun','Blade of Despair'],
 physical:['Malefic Roar','Blade of Despair','Endless Battle'],
 mage:['Divine Glaive','Blood Wings','Lightning Truncheon'],
 magicAssassin:['Divine Glaive','Blood Wings','Starlium Scythe'],
 support:['Oracle','Immortality'],tank:['Immortality','Oracle','Cursed Helmet'],
 fighter:['Malefic Roar','Blade of Despair','Hunter Strike']
};
function defense(item:string){return /Shield|Armor|Cuirass|Crown|Immortality|Wind of Nature|Rose Gold Meteor|Radiant Armor|Oracle|Queen.s Wings|Dominance Ice|Wings$/.test(item) && item!=='Blood Wings';}
export function buildRoute(hero:string,enemies:Array<{hero:string;rating:Rating}>,strength:Strength='equal'):Route{
 const group=heroGroup(hero),core=initialCore(hero).map(x=>x.replace('Athena’s','Athena\'s').replace('Queen’s','Queen\'s'));
 const physical=['basic','physical','fighter'].includes(group),squishy=['basic','physical','mage','magicAssassin'].includes(group);
 const advantage={ 'far-ahead':-2.6,ahead:-1.1,equal:0,behind:1.0,'far-behind':1.8}[strength];
 const entries=new Map<string,RouteItem>();
 function add(item:string,score:number,reason:string,against?:string,kind:RouteItem['kind']='counter'){
  const current=entries.get(item);
  if(!current){entries.set(item,{item,score,reason,against:against?[against]:[],kind});return;}
  // Several enemies benefiting from the same counter increases its value, without double-counting full score.
  if(against&&!current.against.includes(against))current.against.push(against);
  if(score>current.score){current.score=score;current.reason=reason;if(current.kind!=='core')current.kind=kind;}
  else if(against)current.score+=0.45;
 }
 core.forEach((item,i)=>add(item,12-i*0.7,'Essential hero progression',undefined,'core'));
 (groupOffense[group]||groupOffense.fighter).forEach((item,i)=>add(item,8-i*0.65,'Build damage and utility to win fights',undefined,'offense'));
 (pools[group]||pools.fighter).forEach((item,i)=>add(item,4.9-i*0.22,'Situational option for this hero',undefined,defense(item)?'defense':'offense'));
 for(const {hero:enemy,rating} of enemies){
  const severity=rating==='strong'?5.5:rating==='gaining'?2.8:rating==='weak'?0:0.9;
  if(!severity)continue;
  const urgent=severity+advantage;
  if(magicBurst.has(enemy)&&squishy){const item=physical?'Rose Gold Meteor':'Athena\'s Shield';add(item,5.8+urgent,`Survive ${enemy}'s magic burst`,enemy,'defense');}
  if(physicalDamage.has(enemy)&&squishy){const item=physical?'Wind of Nature':'Winter Crown';add(item,5.1+urgent,`Survive ${enemy}'s physical pressure`,enemy,'defense');}
  if(sustain.has(enemy)){const item=physical?'Sea Halberd':group==='mage'||group==='magicAssassin'?'Glowing Wand':'Dominance Ice';add(item,5.7+urgent,`Reduce ${enemy}'s sustain`,enemy,'counter');}
  if(tanks.has(enemy)){const item=physical?'Malefic Roar':group==='mage'||group==='magicAssassin'?'Divine Glaive':group==='support'?'Dominance Ice':'Cursed Helmet';add(item,5.1+urgent,`Deal with ${enemy}'s frontline`,enemy,'counter');}
 }
 // Boots and a hero-defining offensive engine remain at the start; threats can change later slots.
 const first=core.slice(0,2);
 const available=[...entries.values()].filter(x=>!first.includes(x.item));
 available.sort((a,b)=>b.score-a.score||a.item.localeCompare(b.item));
 const ordered=[...first.map(x=>entries.get(x)!),...available];
 const selected:RouteItem[]=[];
 for(const option of ordered){
  if(selected.length>=6)break;
  const defensiveCount=selected.filter(x=>defense(x.item)).length;
  if(squishy&&defense(option.item)&&defensiveCount>=2)continue;
  selected.push(option);
 }
 // Ranked alternatives include plausible swaps, even when defense-slot cap prevents entry.
 const rest=[...entries.values()].filter(x=>!selected.some(y=>y.item===x.item)).sort((a,b)=>b.score-a.score||a.item.localeCompare(b.item));
 const alternatives=rest.slice(0,2);
 const items=[...selected,...alternatives];
 const priority=selected.find(x=>x.against.length>0);
 return {items,recommended:selected,alternatives,strength,headline:priority?`${priority.item}: ${priority.reason}`:`Prioritize ${hero}'s damage and power spikes`};
}
export function routeChange(previous:RouteItem[]|undefined,current:Route):{notify:boolean;title:string;body:string;signature:string}{
 const top=current.recommended.map(x=>x.item),before=(previous||[]).slice(0,6).map(x=>x.item);
 const entered=top.filter(x=>!before.includes(x)),left=before.filter(x=>!top.includes(x));
 const reordered=before.length>0&&top.slice(0,4).join('|')!==before.slice(0,4).join('|');
 const notify=!before.length||entered.length>0||left.length>0||reordered;
 const title=!before.length?'MLBB Coach · Build ready':'MLBB Coach · Build changed';
 const body=entered.length?`Added: ${entered.join(', ')}${left.length?` · Replaced: ${left.join(', ')}`:''}`:reordered?'Priority order changed — open your 8-item route':`Recommended: ${top.slice(0,3).join(' → ')}`;
 return {notify,title,body,signature:top.join('|')};
}
