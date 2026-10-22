import {test} from 'node:test';import {strict as assert} from 'node:assert';
import {buildRoute,routeChange,isStrength} from '../src/build-route.js';
const foes=(v:'weak'|'gaining'|'strong')=>[{hero:'Uranus',rating:v as const},{hero:'Vexana',rating:'weak' as const}];
test('eight ranked items: six recommended and two alternatives, no duplicates',()=>{const r=buildRoute('Karina',foes('gaining'));assert.equal(r.recommended.length,6);assert.equal(r.alternatives.length,2);assert.equal(new Set(r.items.map(x=>x.item)).size,8);assert.equal(r.items[0].item,'Arcane Boots');});
test('strong sustain raises antiheal priority over weak sustain',()=>{const weak=buildRoute('Karina',foes('weak'));const strong=buildRoute('Karina',foes('strong'));assert.ok(strong.items.findIndex(x=>x.item==='Glowing Wand')<weak.items.findIndex(x=>x.item==='Glowing Wand'));});
test('being far ahead makes gaining enemies less urgent',()=>{const ahead=buildRoute('Karina',foes('gaining'),'far-ahead');const behind=buildRoute('Karina',foes('gaining'),'behind');assert.ok(behind.items.findIndex(x=>x.item==='Glowing Wand')<=ahead.items.findIndex(x=>x.item==='Glowing Wand'));});
test('same route never pushes a duplicate',()=>{const r=buildRoute('Karina',foes('weak'));assert.equal(routeChange(undefined,r).notify,true);assert.equal(routeChange(r.items,r).notify,false);});
test('validates strength choices',()=>{assert.equal(isStrength('equal'),true);assert.equal(isStrength('nonsense'),false);});
