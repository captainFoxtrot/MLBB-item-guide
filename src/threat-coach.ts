import type { Roster } from './roster.js';
export type Rating='weak'|'gaining'|'strong'|null;
export type Decision={action:'NEXT'|'SWAP'|'KEEP';item:string|null;replace:string|null;reason:string;source:'rules'|'ai'};
export type ThreatState={core:string[];assumed:string[];pending:Decision|null;ratings:Record<string,Rating>;last:Decision|null;history:Array<{at:string;decision:Decision}>;initialized:boolean};
export const emptyThreatState=():ThreatState=>({core:[],assumed:[],pending:null,ratings:{},last:null,history:[],initialized:false});
const groups:Record<string,string[]>={
 basic:['Miya','Hanabi','Layla','Moskov','Karrie','Claude','Melissa','Wanwan','Irithel','Bruno','Natan','Popol and Kupa','Obsidia'],
 physical:['Clint','Brody','Beatrix','Granger','Lesley','Ixia','Roger','Yi Sun-shin','Saber','Hayabusa','Lancelot','Fanny','Ling','Natalia','Nolan','Suyou','Helcurt','Zilong','Alucard'],
 mage:['Nana','Vale','Valir','Vexana','Eudora','Aurora','Odette','Pharsa','Novaria','Xavier','Yve','Zhask','Gord','Cyclops','Luo Yi','Kadita','Kagura','Cecilion','Lunox','Harith','Harley','Gusion','Chang’e','Alice','Valentina','Zetian'],
 magicAssassin:['Karina','Aamon','Joy','Julian','Selena'],
 support:['Rafaela','Estes','Angela','Floryn','Mathilda','Diggie','Faramis','Kaja','Kalea'],
 tank:['Belerick','Minotaur','Tigreal','Atlas','Khufra','Gatotkaca','Hylos','Uranus','Grock','Lolita','Akai','Baxia','Fredrinn','Barats','Edith','Johnson','Franco','Carmilla','Chip','Gloo'],
 fighter:['Ruby','Terizla','Yu Zhong','Alpha','Thamuz','Dyrroth','Arlott','Cici','Lapu-Lapu','Martis','Leomord','X.Borg','Silvanna','Minsitthar','Balmond','Badang','Khaleed','Hilda','Masha','Chou','Yin','Jawhead','Aldous','Bane','Esmeralda','Phoveus','Guinevere','Lukas']
};
export function heroGroup(hero:string):string{return Object.keys(groups).find(g=>groups[g].includes(hero))||'fighter';}
const cores:Record<string,string[]>={
 basic:['Swift Boots','Corrosion Scythe','Demon Hunter Sword'],
 physical:['Tough Boots','Hunter Strike','Blade of Despair'],
 mage:['Arcane Boots','Genius Wand','Holy Crystal'],
 magicAssassin:['Arcane Boots','Genius Wand','Holy Crystal'],
 support:['Tough Boots','Flask of the Oasis','Enchanted Talisman'],
 tank:['Tough Boots','Dominance Ice','Athena’s Shield'],
 fighter:['Tough Boots','War Axe','Queen’s Wings']
};
export function initialCore(hero:string):string[]{return [...cores[heroGroup(hero)]];}
const magicBurst=new Set(['Karina','Eudora','Kadita','Gusion','Aamon','Aurora','Harley','Lunox','Kagura','Selena','Pharsa','Vale','Nana','Novaria','Xavier','Vexana','Zetian']);
const physicalBurst=new Set(['Saber','Hayabusa','Fanny','Ling','Lancelot','Nolan','Natalia','Helcurt','Brody','Lesley','Clint']);
const physicalDps=new Set(['Hanabi','Miya','Moskov','Layla','Bruno','Melissa','Claude','Karrie','Wanwan','Irithel','Ixia','Granger','Roger']);
const healers=new Set(['Estes','Rafaela','Floryn','Angela','Alice','Ruby','Uranus','Esmeralda','Yu Zhong','Thamuz']);
const tanks=new Set(['Tigreal','Atlas','Belerick','Hylos','Gatotkaca','Uranus','Fredrinn','Barats','Grock','Minotaur','Akai','Khufra','Baxia','Johnson']);
export function candidates(hero:string,enemies:Array<{hero:string;rating:Rating}>):Array<{item:string;reason:string;score:number}>{
 const group=heroGroup(hero),physical=group==='basic'||group==='physical'||group==='fighter';
 const squishy=group==='basic'||group==='physical'||group==='mage'||group==='magicAssassin';
 const out:Array<{item:string;reason:string;score:number}>=[];
 const add=(item:string,reason:string,score:number)=>out.push({item,reason,score});
 for(const {hero:enemy,rating} of enemies){
  const weight=rating==='strong'?6:rating==='gaining'?3:rating==='weak'?0:1;
  if(!weight)continue;
  if(magicBurst.has(enemy)&&squishy){const item=physical?'Rose Gold Meteor':'Athena’s Shield';add(item,`${enemy}'s magic burst is a priority; ${item} improves survival`,weight+3);}
  if((physicalDps.has(enemy)||physicalBurst.has(enemy))&&squishy){const item=physical?'Wind of Nature':'Winter Crown';add(item,`${enemy}'s physical damage is a priority; ${item} helps you survive`,weight+2);}
  if(healers.has(enemy)){const item=physical?'Sea Halberd':group==='mage'||group==='magicAssassin'?'Glowing Wand':'Dominance Ice';add(item,`Reduce ${enemy}'s sustain and healing`,weight+1);}
  if(tanks.has(enemy)&&physical)add('Malefic Roar',`Improve physical penetration against ${enemy}'s frontline defenses`,weight);
 }
 const offense=cores[group]||cores.fighter;
 const extras:Record<string,string[]>={basic:['Golden Staff','Malefic Roar','Immortality'],physical:['Malefic Roar','Immortality'],mage:['Divine Glaive','Blood Wings','Immortality'],magicAssassin:['Divine Glaive','Blood Wings','Immortality'],support:['Immortality','Oracle'],tank:['Immortality','Oracle'],fighter:['Malefic Roar','Immortality']};
 for(const [i,item] of [...offense,...(extras[group]||extras.fighter)].entries())add(item,'Continue your hero’s baseline damage and utility progression',2.2-i*0.15);
 const dedup=new Map<string,{item:string;reason:string;score:number}>();
 for(const c of out){const old=dedup.get(c.item);if(!old||c.score>old.score)dedup.set(c.item,c);}
 return [...dedup.values()].sort((a,b)=>b.score-a.score);
}
export function decide(hero:string,enemies:Array<{hero:string;rating:Rating}>,assumed:string[],core:string[]):Decision{
 const owned=new Set(assumed);const options=candidates(hero,enemies).filter(c=>!owned.has(c.item));
 if(assumed.length<6){const chosen=options[0];return chosen?{action:'NEXT',item:chosen.item,replace:null,reason:chosen.reason,source:'rules'}:{action:'KEEP',item:null,replace:null,reason:'No useful new purchase identified',source:'rules'};}
 // Avoid churn: only replace an item for a meaningful active threat, not to complete a generic build.
 const urgent=options.find(c=>c.score>=8);
 if(!urgent)return {action:'KEEP',item:null,replace:null,reason:'Current six-item build is adequate for the reported threats',source:'rules'};
 const candidatesToReplace=assumed.filter(i=>!core.includes(i));
 // Core swaps are allowed, but only when no adaptive slot can be freed.
 const replace=candidatesToReplace.find(i=>!['Rose Gold Meteor','Wind of Nature','Sea Halberd','Athena’s Shield','Dominance Ice','Glowing Wand'].includes(i))||candidatesToReplace[0]||assumed.find(i=>!i.toLowerCase().includes('boots'))||assumed[0];
 return {action:'SWAP',item:urgent.item,replace,reason:urgent.reason,source:'rules'};
}
export function applyPending(state:ThreatState):ThreatState{
 const next=structuredClone(state),p=next.pending;
 if(!p)return next;
 if(p.action==='NEXT'&&p.item&&!next.assumed.includes(p.item)&&next.assumed.length<6)next.assumed.push(p.item);
 if(p.action==='SWAP'&&p.item&&p.replace){const i=next.assumed.indexOf(p.replace);if(i>=0)next.assumed.splice(i,1,p.item);}
 next.pending=null;return next;
}
export function heroFromRoster(roster:Roster):string|null{return roster.you===null?null:roster.slots[roster.you]?.hero||null;}
export function enemyFromRoster(roster:Roster,ratings:Record<string,Rating>){return roster.slots.slice(5).filter(s=>s.hero).map(s=>({hero:s.hero!,rating:ratings[s.hero!]||null}));}
