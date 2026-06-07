import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { explorerClient } from '../adapters/explorerClient.js';

export function registerReceiptTools(server: McpServer): void {
  server.registerTool(
    'get_session_receipt_logs',
    {
      title: 'Get XDaLa session receipt logs',
      description: 'Use this to inspect what an XDaLa session actually did. Returns decoded engine receipt data such as input payload, API saves, contract saves, execution contract, rule contract, valid flag, inner gas usage and optional raw receipt logs. Do not use this for a simple transaction timeline; use get_session_transactions instead.',
      inputSchema: {
        sessionId: z.string().min(1),
        owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        stepIds: z.array(z.string()).optional(),
        includeTx: z.boolean().optional(),
        includeBlock: z.boolean().optional(),
        includeRaw: z.boolean().optional(),
        limit: z.number().int().min(1).max(10000).optional(),
        filters: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({ sessionId, owner, stepIds = [], includeTx = true, includeBlock = true, includeRaw = false, limit = 500, filters = {} }) => {
      const data = await explorerClient.getSessionReceiptLogs({
        sessionId,
        owner,
        stepIds,
        includeTx,
        includeBlock,
        includeRaw,
        limit,
        filters
      });

      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
