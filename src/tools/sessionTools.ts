import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { explorerClient } from '../adapters/explorerClient.js';
import { rpcCall } from '../adapters/rpcClient.js';

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    'get_session_transactions',
    {
      title: 'Get XDaLa session transactions',
      description: 'Use this to list the blockchain transactions belonging to an XDaLa session. This returns the timeline of transaction hashes, blocks, fees and iteration steps. It does not return full engine payloads, API saves or contract read results.',
      inputSchema: {
        sessionId: z.string().min(1),
        owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ sessionId, owner, page = 1, limit = 50 }) => {
      const data = await explorerClient.getSessionTransactions(sessionId, owner, page, limit);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'get_session_status_live',
    {
      title: 'Get live XDaLa session status',
      description: 'Use this to check live session status from XGR RPC. Returns xgr_sessionAlive for a session owner and session id.',
      inputSchema: {
        sessionId: z.string().min(1),
        owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      }
    },
    async ({ sessionId, owner }) => {
      const alive = await rpcCall<unknown>('xgr_sessionAlive', [owner, sessionId]);
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId, owner, alive }, null, 2) }] };
    }
  );

  server.registerTool(
    'get_sessions_overview',
    {
      title: 'Get XDaLa sessions overview',
      description: 'Use this for high-level indexed XDaLa session analytics from the Explorer API.',
      inputSchema: {
        window: z.enum(['24h', '7d', '30d', '1y', 'all']).optional()
      }
    },
    async ({ window = '30d' }) => {
      const data = await explorerClient.getSessionsOverview(window);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
