import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { blankRoster, normalizeHero, type Roster, type Screen } from './roster.js';
import { digest, secret } from './device.js';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface Instruction { id: number; game_id: number; text: string; created_at: string }
export interface Device { id:string; owner_hash:string; capture_hash:string|null; game_token:string; paired_at:string|null; created_at:string; }
export interface Game { id: number; token: string; status: 'active' | 'ended'; created_at: string; updated_at: string; revision: number }

export function createStore(file: string) {
  const target = file === ':memory:' ? file : resolve(file);
  if (file !== ':memory:') mkdirSync(dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
      revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS instructions (
      id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
      text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
      endpoint TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, capture_hash TEXT,
      game_token TEXT NOT NULL REFERENCES games(token), paired_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_capture ON devices(capture_hash);
    CREATE TABLE IF NOT EXISTS pairing_codes (
      code_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hero_rosters (
      game_id INTEGER PRIMARY KEY REFERENCES games(id), roster_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_analyses (
      game_id INTEGER PRIMARY KEY REFERENCES games(id), result_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS ix_push_game ON push_subscriptions(game_id);
    CREATE INDEX IF NOT EXISTS ix_instructions_game ON instructions(game_id, id DESC);
  `);
  const get = db.prepare('SELECT * FROM games WHERE token = ?');
  const insertGame = db.prepare('INSERT INTO games(token) VALUES (?)');
  const insertInstruction = db.prepare('INSERT INTO instructions(game_id,text) VALUES (?,?)');
  const updateGame = db.prepare("UPDATE games SET revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=?");
  const statusGame = db.prepare("UPDATE games SET status=?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=?");
  const latest = db.prepare('SELECT * FROM instructions WHERE game_id=? ORDER BY id DESC LIMIT 1');
  return {
    db,
    createDevice() {
      return db.transaction(()=>{
        const game=this.createGame();
        const id=randomBytes(12).toString('hex');const ownerKey=secret();
        db.prepare('INSERT INTO devices(id,owner_hash,game_token) VALUES (?,?,?)').run(id,digest(ownerKey),game.token);
        this.setInstruction(game.token,'Waiting for draft screenshot and hero selection.');
        return {id,ownerKey,gameToken:game.token};
      })();
    },
    getDevice(id:string):Device|undefined {return db.prepare('SELECT * FROM devices WHERE id=?').get(id) as Device|undefined;},
    getDeviceByCapture(key:string):Device|undefined {
      if(!key||key.length>256)return undefined;
      return db.prepare('SELECT * FROM devices WHERE capture_hash=?').get(digest(key)) as Device|undefined;
    },
    newPairingCode(id:string) {
      const code=randomBytes(12).toString('base64url');
      db.prepare('DELETE FROM pairing_codes WHERE device_id=? OR expires_at<?').run(id,Date.now());
      db.prepare('INSERT INTO pairing_codes(code_hash,device_id,expires_at) VALUES (?,?,?)').run(digest(code),id,Date.now()+10*60*1000);
      return {code,expiresInSeconds:600};
    },
    claimPairingCode(code:string) {
      if(typeof code!=='string'||code.length>128)return undefined;
      return db.transaction(()=>{
        const row=db.prepare('SELECT device_id,expires_at FROM pairing_codes WHERE code_hash=?').get(digest(code)) as {device_id:string;expires_at:number}|undefined;
        if(!row||row.expires_at<Date.now())return undefined;
        db.prepare('DELETE FROM pairing_codes WHERE device_id=?').run(row.device_id);
        const captureKey=secret();
        db.prepare('UPDATE devices SET capture_hash=?,paired_at=CURRENT_TIMESTAMP WHERE id=?').run(digest(captureKey),row.device_id);
        return {captureKey,deviceId:row.device_id};
      })();
    },
    revokeCapture(id:string) {
      db.prepare('UPDATE devices SET capture_hash=NULL,paired_at=NULL WHERE id=?').run(id);
      db.prepare('DELETE FROM pairing_codes WHERE device_id=?').run(id);
    },
    getLatestAnalysis(token:string):Record<string,any>|null {
      const game=this.getGame(token);if(!game)return null;
      const row=db.prepare('SELECT result_json FROM game_analyses WHERE game_id=?').get(game.id) as {result_json:string}|undefined;
      return row?JSON.parse(row.result_json):null;
    },
    saveLatestAnalysis(token:string,result:Record<string,unknown>){
      const game=this.getGame(token);if(!game)throw Error('Unknown game');
      db.prepare(`INSERT INTO game_analyses(game_id,result_json) VALUES (?,?)
        ON CONFLICT(game_id) DO UPDATE SET result_json=excluded.result_json,updated_at=CURRENT_TIMESTAMP`)
        .run(game.id,JSON.stringify(result));
    },
    getRoster(token:string):Roster {
      const game=this.getGame(token);if(!game)throw Error('Unknown game');
      const row=db.prepare('SELECT roster_json FROM hero_rosters WHERE game_id=?').get(game.id) as {roster_json:string}|undefined;
      return row?JSON.parse(row.roster_json) as Roster:blankRoster();
    },
    saveRoster(token:string,roster:Roster) {
      const game=this.getGame(token);if(!game)throw Error('Unknown game');
      roster.updatedAt=new Date().toISOString();
      db.prepare('INSERT INTO hero_rosters(game_id,roster_json) VALUES (?,?) ON CONFLICT(game_id) DO UPDATE SET roster_json=excluded.roster_json').run(game.id,JSON.stringify(roster));
      updateGame.run(game.id);
      return roster;
    },
    updateRosterManual(token:string,change:{index?:number;hero?:string|null;you?:number|null}) {
      const roster=this.getRoster(token);
      if(Object.hasOwn(change,'index')){
        const index=change.index;
        if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>9)throw Error('Invalid slot index');
        const hero=change.hero===null?null:normalizeHero(change.hero);
        if(change.hero!==null&&!hero)throw Error('Unknown hero');
        roster.slots[index]={...roster.slots[index],hero,locked:true,source:'manual'};
      }
      if(Object.hasOwn(change,'you')){
        if(change.you!==null&&(typeof change.you!=='number'||!Number.isInteger(change.you)||change.you<0||change.you>4))throw Error('You must be an ally slot (0-4)');
        roster.you=change.you??null;roster.youLocked=true;
      }
      return this.saveRoster(token,roster);
    },
    applyRosterDetection(token:string,detected:{heroes?:Array<{side?:string;position?:number;hero?:string}>;you?:number|null;screen?:Screen}) {
      const roster=this.getRoster(token);
      // Preserve manually corrected slots, then accept non-conflicting AI slots.
      // A duplicate on the same team is almost always a recognition error.
      // Across opposing teams, duplicates are permitted in non-draft modes.
      const accepted = new Set<string>();
      for(const slot of roster.slots){
        if(slot.locked&&slot.hero)accepted.add(`${slot.side}:${slot.hero.toLocaleLowerCase()}`);
      }
      const seenPositions=new Set<number>();
      if(Array.isArray(detected.heroes))for(const h of detected.heroes){
        const pos=h.position;
        if(typeof pos!=='number'||!Number.isInteger(pos)||pos<0||pos>4)continue;
        const index=(h.side==='enemy'?5:h.side==='ally'?0:-1)+pos;
        if(index<0||index>9||seenPositions.has(index)||roster.slots[index].locked)continue;
        seenPositions.add(index);
        const hero=normalizeHero(h.hero);
        if(!hero)continue;
        const identity=`${h.side}:${hero.toLocaleLowerCase()}`;
        if(accepted.has(identity)){
          // Do not retain a stale AI guess at a duplicate position.
          roster.slots[index]={...roster.slots[index],hero:null,source:null};
          continue;
        }
        accepted.add(identity);
        roster.slots[index]={...roster.slots[index],hero,source:'ai'};
      }
      if(!roster.youLocked&&typeof detected.you==='number'&&Number.isInteger(detected.you)&&detected.you>=0&&detected.you<=4)roster.you=detected.you;
      if(['draft','loading','scoreboard','unknown'].includes(detected.screen||''))roster.screen=detected.screen!;
      return this.saveRoster(token,roster);
    },
    createGame(): Game {
      for (let i=0; i<4; i++) {
        const token = randomBytes(9).toString('hex').toUpperCase();
        try { insertGame.run(token); return get.get(token) as Game; } catch (e) {
          if (!(e instanceof Error) || !e.message.includes('UNIQUE')) throw e;
        }
      }
      throw new Error('Unable to allocate token');
    },
    getGame(token: string): Game | undefined { return get.get(token.toUpperCase()) as Game | undefined; },
    latestInstruction(game: Game): Instruction | undefined { return latest.get(game.id) as Instruction | undefined; },
    setInstruction(token: string, text: string) {
      const clean = text.trim();
      if (!clean || clean.length > 750) throw new Error('Instruction must be 1-750 characters');
      return db.transaction(() => {
        const game = get.get(token.toUpperCase()) as Game | undefined;
        if (!game) throw new Error('Unknown game token');
        if (game.status !== 'active') throw new Error('Game ended; start a new game for this token');
        insertInstruction.run(game.id, clean);
        updateGame.run(game.id);
        return { game: get.get(game.token) as Game, instruction: latest.get(game.id) as Instruction };
      })();
    },
    addSubscription(token:string, sub:{endpoint:string}) {
      const game=get.get(token.toUpperCase()) as Game|undefined;
      if(!game)throw Error('Unknown game');
      db.prepare('INSERT INTO push_subscriptions(game_id,endpoint,subscription) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET game_id=excluded.game_id,subscription=excluded.subscription').run(game.id,sub.endpoint,JSON.stringify(sub));
    },
    deleteSubscription(endpoint:string){db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);},
    getSubscriptions(token:string):Array<{endpoint:string;subscription:string}>{
      const game=get.get(token.toUpperCase()) as Game|undefined;
      return game?db.prepare('SELECT endpoint,subscription FROM push_subscriptions WHERE game_id=?').all(game.id) as Array<{endpoint:string;subscription:string}>:[];
    },
    newRound(token: string) {
      return db.transaction(() => {
        const game = get.get(token.toUpperCase()) as Game | undefined;
        if (!game) throw new Error('Unknown game token');
        // Preserve history but mark the round boundary with a fresh instruction.
        statusGame.run('active', game.id);
        insertInstruction.run(game.id, 'New match started. Awaiting hero selection and draft screenshot.');
        db.prepare('DELETE FROM hero_rosters WHERE game_id=?').run(game.id);
        db.prepare('DELETE FROM game_analyses WHERE game_id=?').run(game.id);
        updateGame.run(game.id);
        return get.get(game.token) as Game;
      })();
    },
    end(token: string) {
      const game = get.get(token.toUpperCase()) as Game | undefined;
      if (!game) throw new Error('Unknown game token');
      statusGame.run('ended', game.id);
      return get.get(game.token) as Game;
    }
  };
}
export type Store = ReturnType<typeof createStore>;
