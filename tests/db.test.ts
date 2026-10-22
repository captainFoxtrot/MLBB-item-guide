import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {createStore} from '../src/db.js';
import { instructionSvg } from '../src/stream.js';
test('token persists and instructions increment revisions',()=>{
 const s=createStore(':memory:');const g=s.createGame();assert.equal(g.token.length,18);
 assert.equal(s.getGame(g.token)?.status,'active');
 const a=s.setInstruction(g.token,'Buy burst protection');assert.equal(a.game.revision,1);
 assert.equal(s.latestInstruction(a.game)?.text,'Buy burst protection');
 s.end(g.token);assert.throws(()=>s.setInstruction(g.token,'cannot write'));
 s.newRound(g.token);assert.equal(s.getGame(g.token)?.status,'active');
 assert.match(s.latestInstruction(s.getGame(g.token)!)!.text,/New match/);s.db.close();
});
test('video SVG escapes untrusted coaching text',()=>{const svg=instructionSvg('<attack> & win','active');assert.ok(svg.includes('&lt;attack&gt;'));assert.ok(svg.includes('&amp; win'));});
test('device pairing is single use, revocable, and maps to active match',()=>{
 const s=createStore(':memory:');
 const device=s.createDevice();
 assert.ok(s.getGame(device.gameToken));
 const code=s.newPairingCode(device.id).code;
 const paired=s.claimPairingCode(code);
 assert.ok(paired?.captureKey);
 assert.equal(s.claimPairingCode(code),undefined);
 assert.equal(s.getDeviceByCapture(paired!.captureKey)?.game_token,device.gameToken);
 s.revokeCapture(device.id);
 assert.equal(s.getDeviceByCapture(paired!.captureKey),undefined);
 s.db.close();
});
test('AI updates keep slot order and never overwrite manual hero or YOU selection',()=>{
 const s=createStore(':memory:');const d=s.createDevice();
 s.updateRosterManual(d.gameToken,{index:2,hero:'Pharsa'});
 s.updateRosterManual(d.gameToken,{you:2});
 s.applyRosterDetection(d.gameToken,{screen:'draft',you:1,heroes:[
  {side:'ally',position:2,hero:'Layla'},
  {side:'ally',position:0,hero:'Tigreal'},
  {side:'enemy',position:0,hero:'Fanny'}
 ]});
 const r=s.getRoster(d.gameToken);
 assert.equal(r.slots[2].hero,'Pharsa');assert.equal(r.slots[0].hero,'Tigreal');
 assert.equal(r.slots[5].hero,'Fanny');assert.equal(r.you,2);
 assert.equal(r.screen,'draft');
 s.newRound(d.gameToken);
 assert.equal(s.getRoster(d.gameToken).slots[2].hero,null);
 s.db.close();
});
