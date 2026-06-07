import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { explorerClient } from '../adapters/explorerClient.js';
import { rpcCall } from '../adapters/rpcClient.js';
import {
  getAccountTransactionsDb,
  getBlockTransactionsDb,
  getRecentValueTransfersDb,
  getTransactionStatsDb,
  safeTransactionDb,
  searchTransactionsDb
} from '../adapters/transactionDbClient.js';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const weiSchema = z.string().regex(/^\d+$/);
const pageSchema = z.number().int().min(1).optional();
const limitSchema = z.number().int().min(1).max(200).optional();
const windowHoursSchema = z.number().int().min(0).max(8760).optional();
const blockSchema = z.number().int().min(0).optional();

function textJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerTransactionTools(server: McpServer): void {
  server.registerTool(
    'get_transaction_evidence',
    {
      title: 'Get transaction evidence',
      description: 'Use this when the user asks what happened in a specific transaction. Combines indexed Explorer transaction data, receipt data and live RPC fallback if available.',
      inputSchema: {
        txHash: txHashSchema
      }
    },
    async ({ txHash }) => {
      const [explorerTx, explorerReceipt, liveTx] = await Promise.allSettled([
        explorerClient.getTransaction(txHash),
        explorerClient.getTransactionReceipt(txHash),
        rpcCall<unknown>('eth_getTransactionByHash', [txHash])
      ]);

      const payload = {
        txHash,
        explorerTransaction: explorerTx.status === 'fulfilled' ? explorerTx.value : null,
        explorerReceipt: explorerReceipt.status === 'fulfilled' ? explorerReceipt.value : null,
        liveTransaction: liveTx.status === 'fulfilled' ? liveTx.value : null
      };

      return textJson(payload);
    }
  );

  server.registerTool(
    'get_transaction_receipt',
    {
      title: 'Get transaction receipt',
      description: 'Use this for receipt logs, status and gas usage of a transaction. Prefers Explorer decoded receipt data.',
      inputSchema: {
        txHash: txHashSchema
      }
    },
    async ({ txHash }) => {
      const receipt = await explorerClient.getTransactionReceipt(txHash);
      return textJson(receipt);
    }
  );

  server.registerTool(
    'search_transactions',
    {
      title: 'Search transactions',
      description: 'Read-only chain-wide Explorer DB transaction search. Use for general transaction, native XGR value, from/to address, hash, input, session id, validity/execution, and block/time-range questions; do not sample XDaLa sessions for chain-wide transaction questions.',
      inputSchema: {
        from: addressSchema.optional(),
        to: addressSchema.optional(),
        txHash: txHashSchema.optional(),
        valueGtWei: weiSchema.optional(),
        valueEqWei: weiSchema.optional(),
        valueLtWei: weiSchema.optional(),
        hasValue: z.boolean().optional(),
        hasInput: z.boolean().optional(),
        contractCreation: z.boolean().optional(),
        sessionId: z.string().min(1).optional(),
        valid: z.boolean().optional(),
        executed: z.boolean().optional(),
        windowHours: windowHoursSchema,
        fromBlock: blockSchema,
        toBlock: blockSchema,
        page: pageSchema,
        limit: limitSchema
      }
    },
    async (input) => {
      const db = await safeTransactionDb(() => searchTransactionsDb(input));
      return textJson(db.ok ? db.value : { source: 'unavailable', transactions: [], warning: db.message });
    }
  );

  server.registerTool(
    'get_recent_value_transfers',
    {
      title: 'Get recent value transfers',
      description: 'Read-only shortcut for recent native XGR value transfers from the Explorer transaction index. Native value transfer means transactions.value > minValueWei and does not include gas fees.',
      inputSchema: {
        windowHours: windowHoursSchema,
        minValueWei: weiSchema.optional(),
        from: addressSchema.optional(),
        to: addressSchema.optional(),
        page: pageSchema,
        limit: limitSchema
      }
    },
    async (input) => {
      const db = await safeTransactionDb(() => getRecentValueTransfersDb(input));
      return textJson(db.ok ? db.value : { source: 'unavailable', windowHours: input.windowHours ?? 24, countReturned: 0, totalValueWeiReturned: '0', transfers: [], warning: db.message });
    }
  );

  server.registerTool(
    'get_account_transactions',
    {
      title: 'Get account transactions',
      description: 'Read-only chain-wide Explorer DB transaction lookup for one account as sender, recipient, or both. Use this instead of XDaLa session tools for account-wide transaction history.',
      inputSchema: {
        address: addressSchema,
        direction: z.enum(['in', 'out', 'both']).optional(),
        valueOnly: z.boolean().optional(),
        windowHours: windowHoursSchema,
        page: pageSchema,
        limit: limitSchema
      }
    },
    async (input) => {
      const db = await safeTransactionDb(() => getAccountTransactionsDb(input));
      return textJson(db.ok ? db.value : { source: 'unavailable', transactions: [], warning: db.message });
    }
  );

  server.registerTool(
    'get_block_transactions',
    {
      title: 'Get block transactions',
      description: 'Read-only list of transactions in a specific indexed block, latest indexed block, or latest indexed block minus latestOffset.',
      inputSchema: {
        blockNumber: blockSchema,
        latestOffset: z.number().int().min(0).optional(),
        page: pageSchema,
        limit: limitSchema
      }
    },
    async (input) => {
      const db = await safeTransactionDb(() => getBlockTransactionsDb(input));
      return textJson(db.ok ? db.value : { source: 'unavailable', blockNumber: input.blockNumber ?? 0, blockTimestamp: null, countReturned: 0, transactions: [], warning: db.message });
    }
  );

  server.registerTool(
    'get_transaction_stats',
    {
      title: 'Get transaction stats',
      description: 'Read-only compact chain transaction statistics from the Explorer transaction index, with optional block or block-timestamp window filters.',
      inputSchema: {
        windowHours: windowHoursSchema,
        fromBlock: blockSchema,
        toBlock: blockSchema
      }
    },
    async (input) => {
      const db = await safeTransactionDb(() => getTransactionStatsDb(input));
      return textJson(db.ok ? db.value : {
        source: 'unavailable',
        totalTransactions: '0',
        valueTransferCount: '0',
        zeroValueCount: '0',
        contractCreationCount: '0',
        totalValueWei: '0',
        firstBlock: null,
        lastBlock: null,
        warning: db.message
      });
    }
  );
}
