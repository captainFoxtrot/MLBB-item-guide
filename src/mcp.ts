import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Store } from './db.js';

export function createMcp(store: Store) {
  const server = new McpServer({ name: 'mlbb-item-coach-display', version: '1.0.0' });
  server.registerTool('get_game', {
    description: 'Find a current MLBB coach session by user-provided token, returning current instruction and status.',
    inputSchema: { token: z.string().min(12) }
  }, async ({ token }) => {
    const game = store.getGame(token);
    if (!game) return { isError: true, content: [{ type: 'text', text: 'Unknown token' }] };
    return { content: [{ type: 'text', text: JSON.stringify({ token: game.token, status: game.status, revision: game.revision, instruction: store.latestInstruction(game)?.text ?? null }) }] };
  });
  server.registerTool('set_instruction', {
    description: 'Publish the latest short MLBB build recommendation to the user\'s PiP display. After analyzing a screenshot or update, set a self-contained next purchase and brief reason. This replaces the previously displayed instruction.',
    inputSchema: { token: z.string().min(12), text: z.string().min(1).max(750) }
  }, async ({ token, text }) => {
    try {
      const {game} = store.setInstruction(token, text);
      return { content: [{ type: 'text', text: `Instruction published, revision ${game.revision}.` }] };
    } catch (err) { return { isError: true, content: [{ type: 'text', text: (err as Error).message }] }; }
  });
  server.registerTool('start_new_match', {
    description: 'Reuse the same token for another MLBB match, retaining history and resetting the visible instruction.',
    inputSchema: { token: z.string().min(12) }
  }, async ({token}) => {
    try { const game = store.newRound(token); return {content:[{type:'text',text:`New match active. Revision ${game.revision}. Awaiting hero selection.`}]}; }
    catch (err) {return {isError:true,content:[{type:'text',text:(err as Error).message}]};}
  });
  server.registerTool('end_match', {
    description: 'Mark the game as ended. The same token can start another match later.',
    inputSchema: { token: z.string().min(12) }
  }, async ({token}) => {
    try { store.end(token); return {content:[{type:'text',text:'Match ended.'}]}; }
    catch (err) {return {isError:true,content:[{type:'text',text:(err as Error).message}]};}
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  return {server, transport};
}
