import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface Instruction { id: number; game_id: number; text: string; created_at: string }
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
