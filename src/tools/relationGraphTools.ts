import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { explorerClient } from '../adapters/explorerClient.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const direction = z.enum(['in', 'out', 'both']).optional();
const depth = z.number().int().min(1).max(4).optional();
const minValueWei = z.string().regex(/^\d+$/).optional();
const timestamp = z.number().int().nonnegative().optional();
const maxNodes = z.number().int().min(1).max(300).optional();
const maxEdges = z.number().int().min(1).max(500).optional();
const boundedOrAll = z.union([z.number().int().min(1), z.literal('all')]).optional();

function textJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function graphParams(input: {
  direction?: 'in' | 'out' | 'both'; depth?: number; minValueWei?: string;
  fromTimestamp?: number; toTimestamp?: number; aggregate?: boolean;
  maxNodes?: number; maxEdges?: number;
}) {
  return {
    direction: input.direction ?? 'both',
    depth: input.depth ?? 1,
    min_value_wei: input.minValueWei ?? '0',
    from_timestamp: input.fromTimestamp,
    to_timestamp: input.toTimestamp,
    asset: 'native',
    aggregate: input.aggregate ?? true,
    max_nodes: input.maxNodes ?? 100,
    max_edges: input.maxEdges ?? 150,
  };
}

export function registerRelationGraphTools(server: McpServer): void {
  server.registerTool('get_address_relation_graph', {
    title: 'Get XGR address relation graph',
    description: 'Read-only bounded graph of indexed native XGR transfers around an address. Returns aggregated on-chain relations, verified Explorer labels, depth and truncation metadata. A relation proves only that transactions occurred between addresses; it does not imply common ownership or identity.',
    inputSchema: {
      address,
      direction,
      depth,
      minValueWei,
      fromTimestamp: timestamp,
      toTimestamp: timestamp,
      aggregate: z.boolean().optional(),
      maxNodes,
      maxEdges,
    }
  }, async (input) => textJson(await explorerClient.getAddressRelationGraph(input.address, graphParams(input))));

  server.registerTool('expand_address_relation_graph', {
    title: 'Expand XGR address graph neighbors',
    description: 'Read-only progressive expansion of one address by exactly one graph level. Use this instead of requesting a larger graph when exploring interactively.',
    inputSchema: {
      address,
      direction,
      minValueWei,
      fromTimestamp: timestamp,
      toTimestamp: timestamp,
      aggregate: z.boolean().optional(),
      maxNodes: z.number().int().min(1).max(300).optional(),
      maxEdges: z.number().int().min(1).max(500).optional(),
    }
  }, async (input) => textJson(await explorerClient.getRelationGraphNeighbors(input.address, graphParams({ ...input, depth: 1 }))));

  server.registerTool('trace_xgr_transaction', {
    title: 'Trace an XGR transaction relation graph',
    description: 'Loads an indexed transaction, uses its sender as the bounded graph root, returns sender/recipient trace roots plus the graph and an explicit edge to highlight. Useful for following native XGR transaction relations, but it does not attribute later mixed balances to the seed value.',
    inputSchema: {
      txHash,
      direction,
      depth,
      minValueWei,
      fromTimestamp: timestamp,
      toTimestamp: timestamp,
      maxNodes,
      maxEdges,
    }
  }, async (input) => {
    const tx = await explorerClient.getTransaction(input.txHash) as Record<string, unknown>;
    const fromAddress = typeof tx?.fromAddress === 'string' ? tx.fromAddress : null;
    const toAddress = typeof tx?.toAddress === 'string' ? tx.toAddress : null;
    if (!fromAddress && !toAddress) throw new Error('Explorer transaction does not contain a sender or recipient.');
    const root = fromAddress ?? toAddress!;
    const graph = await explorerClient.getAddressRelationGraph(root, graphParams(input));
    return textJson({
      transaction: tx,
      root,
      transactionRoots: [fromAddress, toAddress].filter(Boolean),
      highlightEdge: fromAddress && toAddress ? { source: fromAddress.toLowerCase(), target: toAddress.toLowerCase(), txHash: input.txHash.toLowerCase() } : null,
      graph,
    });
  });

  server.registerTool('trace_xgr_value_flow', {
    title: 'Trace native XGR value provenance',
    description: 'Read-only native-XGR value-flow analysis starting from one transaction. Use model="possible" for conservative attribution ranges or model="proportional" for haircut attribution. Native XGR has no per-coin identity, so results are provenance models rather than proof that a specific coin moved. maxTransfers and maxHops accept a number or "all"; "all" is still bounded by Explorer server safety caps and reports truncation explicitly.',
    inputSchema: {
      txHash,
      amountWei: z.string().regex(/^\d+$/).optional().describe('Optional amount of the seed transaction value to trace in wei. Defaults to the full native XGR value of the seed transaction.'),
      model: z.enum(['possible', 'proportional']).optional().describe('possible returns attribution ranges; proportional applies a haircut/share model.'),
      maxTransfers: boundedOrAll.describe('Maximum propagated transfers to return, or "all" to continue until exhaustion subject to server safety caps.'),
      maxHops: boundedOrAll.describe('Maximum propagation hops from the seed recipient, or "all" subject to server safety caps.'),
      minAttributedWei: z.string().regex(/^\d+$/).optional().describe('Ignore branches whose possible/attributed amount falls below this wei threshold.'),
    }
  }, async (input) => textJson(await explorerClient.getNativeXgrValueFlow(input.txHash, {
    amount_wei: input.amountWei,
    model: input.model ?? 'possible',
    max_transfers: input.maxTransfers ?? 100,
    max_hops: input.maxHops ?? 5,
    min_attributed_wei: input.minAttributedWei ?? '1',
  })));

  server.registerTool('get_relation_edge_transactions', {
    title: 'Get transactions behind an XGR graph relation',
    description: 'Returns the indexed native XGR transactions represented by one directed graph edge, with the same minimum-value and time filters used by the relation graph.',
    inputSchema: {
      source: address.describe('Source EVM address of the directed graph relation.'),
      target: address.describe('Target EVM address of the directed graph relation.'),
      minValueWei,
      fromTimestamp: timestamp,
      toTimestamp: timestamp,
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }
  }, async (input) => textJson(await explorerClient.getRelationEdgeTransactions({
    source: input.source,
    target: input.target,
    min_value_wei: input.minValueWei ?? '0',
    from_timestamp: input.fromTimestamp,
    to_timestamp: input.toTimestamp,
    page: input.page ?? 1,
    limit: input.limit ?? 50,
  })));
}