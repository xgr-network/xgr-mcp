import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../adapters/rpcClient.js';

export function registerChainTools(server: McpServer): void {
  server.registerTool(
    'get_chain_status',
    {
      title: 'Get XGRChain status',
      description: 'Use this for live XGRChain status. Returns chain id, latest block number and gas price from JSON-RPC.',
      inputSchema: {}
    },
    async () => {
      const [chainId, blockNumber, gasPrice] = await Promise.all([
        rpcCall<string>('eth_chainId'),
        rpcCall<string>('eth_blockNumber'),
        rpcCall<string>('eth_gasPrice')
      ]);

      return {
        content: [{ type: 'text', text: JSON.stringify({ chainId, blockNumber, gasPrice }, null, 2) }]
      };
    }
  );

  server.registerTool(
    'get_latest_block',
    {
      title: 'Get latest block',
      description: 'Use this when the user asks for the latest EVM block details from XGRChain.',
      inputSchema: {}
    },
    async () => {
      const block = await rpcCall<unknown>('eth_getBlockByNumber', ['latest', true]);
      return { content: [{ type: 'text', text: JSON.stringify(block, null, 2) }] };
    }
  );

  server.registerTool(
    'get_account_live_state',
    {
      title: 'Get account live state',
      description: 'Use this for live EVM account state. Returns balance, nonce and contract code for an address.',
      inputSchema: {
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      }
    },
    async ({ address }) => {
      const [balance, nonce, code] = await Promise.all([
        rpcCall<string>('eth_getBalance', [address, 'latest']),
        rpcCall<string>('eth_getTransactionCount', [address, 'latest']),
        rpcCall<string>('eth_getCode', [address, 'latest'])
      ]);

      return {
        content: [{ type: 'text', text: JSON.stringify({ address, balance, nonce, isContract: code !== '0x', code }, null, 2) }]
      };
    }
  );
}
