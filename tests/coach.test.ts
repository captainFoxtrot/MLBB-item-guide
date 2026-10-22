import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {blankRoster} from '../src/roster.js';
import {resolvePlayerHero,decideAdvice,normalizeMatchState,shouldNotify,fallbackAdvice} from '../src/coach.js';
const state=normalizeMatchState(null);
const vision={screen:'scoreboard' as const,heroes:[],you:0,inventory:[],inventoryReadable:false,confidence:'low' as const,matchState:state};
const advice={nextItem:'Genius Wand',reason:'Magic penetration against enemy frontline',coreItems:['Genius Wand'],situationalItems:[],confidence:'high' as const};
function karina(){const r=blankRoster();r.you=1;r.youLocked=true;r.slots[0].hero='Freya';r.slots[1].hero='Karina';return r;}
test('authoritative YOU slot wins over screenshot guesses',()=>{
 const roster=karina();assert.equal(resolvePlayerHero(roster),'Karina');
 assert.equal(decideAdvice(roster,vision,advice).status,'provisional');
});
test('draft and loading screens produce provisional CORE advice',()=>{
 const roster=karina();
 for(const screen of ['draft','loading'] as const){const d=decideAdvice(roster,{...vision,screen},advice);assert.equal(d.nextItem,'Genius Wand');assert.equal(d.status,'provisional');}
});
test('scoreboard inventory determines provisional versus actionable',()=>{
 const roster=karina();assert.equal(decideAdvice(roster,vision,advice).status,'provisional');
 assert.equal(decideAdvice(roster,{...vision,inventoryReadable:true},advice).status,'actionable');
});
test('never suggest an already owned item as a next purchase',()=>{
 const d=decideAdvice(karina(),{...vision,inventoryReadable:true,inventory:['Genius Wand']},advice);
 assert.equal(d.status,'waiting');
});
test('unknown player is waiting; a clear scoreboard is not enough',()=>{
 assert.equal(decideAdvice(blankRoster(),vision,advice).status,'waiting');
});
test('match state uses null for unknown objectives and keeps real values',()=>{
 const m=normalizeMatchState({time:'12:46',kills:{ally:11,enemy:18},gold:{ally:35300,enemy:39100},turtles:{ally:2,enemy:'unreadable'},player:{level:12},enemyItems:{Karina:['Holy Crystal']}});
 assert.equal(m.turtles.enemy,null);assert.equal(m.lords.ally,null);assert.equal(m.gold.enemy,39100);assert.equal(m.player.level,12);assert.deepEqual(m.enemyItems,{});
});
test('pushes on initial CORE, changes, CORE-to-NEXT, and retries failed delivery',()=>{
 const d={status:'provisional' as const,nextItem:'Queen’s Wings'};
 assert.equal(shouldNotify(null,d,'loading'),true);
 const old={adviceStatus:'provisional',screen:'loading',nextItem:'Queen’s Wings',notificationQueued:true,notification:{delivered:1}};
 assert.equal(shouldNotify(old,d,'loading'),false);
 assert.equal(shouldNotify(old,d,'scoreboard'),true);
 assert.equal(shouldNotify({...old,notification:{delivered:0}},d,'loading'),true);
 assert.equal(shouldNotify(old,{...d,nextItem:'Rose Gold Meteor'},'loading'),true);
 assert.equal(shouldNotify(old,{status:'waiting',nextItem:'none'},'scoreboard'),false);
});

test('invalid clock never masquerades as gold',()=>{
 assert.equal(normalizeMatchState({time:'35.3k'}).time,null);
 assert.equal(normalizeMatchState({time:'11:46'}).time,'11:46');
 assert.equal(normalizeMatchState({time:'11:99'}).time,null);
});
test('rate-limit fallback gives Miya a provisional anti-heal recommendation against Estes',()=>{
 const a=fallbackAdvice('Miya',['Estes','Karina','Nana'],[],false,'scoreboard');
 assert.equal(a?.nextItem,'Sea Halberd');
 assert.equal(a?.confidence,'low');
});
test('local fallback avoids confirmed owned items',()=>{
 const a=fallbackAdvice('Miya',['Estes'],['Sea Halberd','Corrosion Scythe'],true,'scoreboard');
 assert.equal(a?.nextItem,'Demon Hunter Sword');
});
test('fallback declines unsupported heroes rather than inventing build',()=>{
 assert.equal(fallbackAdvice('Unknown Hero',[],[],false,'loading'),null);
});
