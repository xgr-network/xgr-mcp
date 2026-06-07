import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../adapters/rpcClient.js';

export function registerXgrTools(server: McpServer): void {
  server.registerTool(
    'get_xgr_core_addresses',
    {
      title: 'Get XGR core addresses',
      description: 'Use this to retrieve XGR core protocol addresses exposed by the xgr_getCoreAddrs RPC method.',
      inputSchema: {}
    },
    async () => {
      const data = await rpcCall<unknown>('xgr_getCoreAddrs');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xgr_circulating_supply',
    {
      title: 'Get XGR circulating supply',
      description: 'Use this to retrieve circulating supply information exposed by xgr_getCirculatingSupply.',
      inputSchema: {}
    },
    async () => {
      const data = await rpcCall<unknown>('xgr_getCirculatingSupply');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'estimate_xdala_rule_gas',
    {
      title: 'Estimate XDaLa rule gas',
      description: 'Use this to estimate XDaLa/XRC-137 rule gas. Returns validation gas, branch gas, grant fees and worst-case totals from xgr_estimateRuleGas.',
      inputSchema: {
        json: z.string().min(1),
        encrypted: z.boolean().optional(),
        validSpawns: z.number().int().min(0).optional(),
        invalidSpawns: z.number().int().min(0).optional()
      }
    },
    async (input) => {
      const data = await rpcCall<unknown>('xgr_estimateRuleGas', [input]);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
