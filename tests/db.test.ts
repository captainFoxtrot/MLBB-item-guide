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
