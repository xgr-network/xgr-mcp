import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { xrcExplorerClient } from '../adapters/xrcExplorerClient.js';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const pageSchema = z.number().int().min(1).optional();
const limitSchema = z.number().int().min(1).max(100).optional();

function textJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function firstArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['data', 'items', 'contracts', 'results', 'rows']) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstObject(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (obj[key] !== undefined) return obj[key];
  return null;
}

function paginationMetadata(payload: unknown, requestedPage?: number, requestedLimit?: number) {
  const root = firstObject(payload) ?? {};
  const data = firstObject(root.data) ?? {};
  const source = Object.keys(data).length > 0 ? data : root;
  return {
    page: pick(source, 'page', 'currentPage', 'current_page') ?? requestedPage ?? 1,
    limit: pick(source, 'limit', 'pageSize', 'page_size') ?? requestedLimit ?? null,
    total: pick(source, 'total', 'totalCount', 'total_count'),
    totalPages: pick(source, 'totalPages', 'total_pages'),
    hasNext: pick(source, 'hasNext', 'has_next'),
    nextPage: pick(source, 'nextPage', 'next_page')
  };
}

function normalizeExecutorRelation(row: unknown) {
  const obj = firstObject(row) ?? {};
  const event = firstObject(pick(obj, 'lastExecutorEvent', 'executorEvent')) ?? {};
  const contractAddress = pick(obj, 'contractAddress', 'contract_address', 'address');
  return {
    contractAddress,
    orchestration: contractAddress,
    address: contractAddress,
    xrc729: contractAddress,
    xrcType: pick(obj, 'xrcType', 'xrc_type', 'type'),
    role: 'executor',
    startable: pick(obj, 'status') === 'active' || pick(obj, 'active') === true,
    status: pick(obj, 'status'),
    active: pick(obj, 'active'),
    verifiedOnchain: pick(obj, 'verifiedOnchain'),
    executor: pick(obj, 'executor'),
    owner: pick(obj, 'owner'),
    title: pick(obj, 'nameXrc', 'name_xrc', 'name'),
    nameXrc: pick(obj, 'nameXrc', 'name_xrc', 'name'),
    schemaVersion: pick(obj, 'schemaVersion', 'schema_version'),
    firstSeenBlock: pick(obj, 'firstSeenBlock', 'first_seen_block'),
    lastSeenBlock: pick(obj, 'lastSeenBlock', 'last_seen_block'),
    deployedAt: pick(event, 'blockTimestamp', 'block_timestamp'),
    deployTxHash: pick(event, 'txHash', 'tx_hash'),
    deployBlock: pick(event, 'blockNumber', 'block_number'),
    lastExecutorEvent: event,
    source: 'explorer_executor_relations'
  };
}

export function registerXrcExecutorTools(server: McpServer): void {
  server.registerTool('list_xrc729_contracts_by_executor', {
    title: 'List XRC-729 contracts by executor',
    description: 'Read-only Explorer lookup for active XRC-729 executor relations of one address. This is index-backed, does not scan contracts, and returns Explorer pagination metadata.',
    inputSchema: { executor: addressSchema, page: pageSchema, limit: limitSchema }
  }, async ({ executor, page, limit }) => {
    const normalizedExecutor = executor.toLowerCase();
    const response = await xrcExplorerClient.listXrc729ContractsByExecutor(normalizedExecutor, { page, limit, status: 'active' });
    const contracts = firstArray(response).map(normalizeExecutorRelation).filter((row) => row.contractAddress);
    return textJson({
      source: 'explorer_executor_relations',
      executor: normalizedExecutor,
      role: 'executor',
      pagination: paginationMetadata(response, page, limit),
      contracts,
      workflows: contracts
    });
  });
}
