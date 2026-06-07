import { explorerDbQuery, hasExplorerDbConfig } from './explorerDbClient.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const DEFAULT_RECENT_WINDOW_HOURS = 24;

type Direction = 'in' | 'out' | 'both';

interface TransactionColumns {
  hasNonce: boolean;
  hasType: boolean;
  gasColumn: string | null;
  gasPriceColumn: string | null;
  maxPriorityFeePerGasColumn: string | null;
  maxFeePerGasColumn: string | null;
}

interface TransactionRow {
  hash: string | null;
  block_number: string | number | null;
  block_timestamp: Date | string | null;
  transaction_index: string | number | null;
  from_address: string | null;
  to_address: string | null;
  input_data: string | null;
  value: string | number | null;
  nonce: string | number | null;
  type: string | number | null;
  gas_limit: string | number | null;
  gas_price: string | number | null;
  max_priority_fee_per_gas: string | number | null;
  max_fee_per_gas: string | number | null;
  session_id: string | null;
  valid: boolean | null;
  executed: boolean | null;
  session_alive: boolean | null;
}

interface StatsRow {
  total_transactions: string | null;
  value_transfer_count: string | null;
  zero_value_count: string | null;
  contract_creation_count: string | null;
  total_value_wei: string | null;
  first_block: string | number | null;
  last_block: string | number | null;
}

interface LatestBlockRow {
  block_number: string | number | null;
  block_timestamp: Date | string | null;
}

export interface SearchTransactionsInput {
  from?: string;
  to?: string;
  txHash?: string;
  valueGtWei?: string;
  valueEqWei?: string;
  valueLtWei?: string;
  hasValue?: boolean;
  hasInput?: boolean;
  contractCreation?: boolean;
  sessionId?: string;
  valid?: boolean;
  executed?: boolean;
  windowHours?: number;
  fromBlock?: number;
  toBlock?: number;
  page?: number;
  limit?: number;
}

export interface GetRecentValueTransfersInput {
  windowHours?: number;
  minValueWei?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface GetAccountTransactionsInput {
  address: string;
  direction?: Direction;
  valueOnly?: boolean;
  windowHours?: number;
  page?: number;
  limit?: number;
}

export interface GetBlockTransactionsInput {
  blockNumber?: number;
  latestOffset?: number;
  page?: number;
  limit?: number;
}

export interface GetTransactionStatsInput {
  windowHours?: number;
  fromBlock?: number;
  toBlock?: number;
}

export interface NormalizedTransaction {
  hash: string | null;
  blockNumber: string | number | null;
  blockTimestamp: string | null;
  transactionIndex: string | number | null;
  from: string | null;
  to: string | null;
  valueWei: string | number | null;
  inputData: string | null;
  nonce: string | number | null;
  type: string | number | null;
  gasLimit: string | number | null;
  gasPrice: string | number | null;
  maxPriorityFeePerGas: string | number | null;
  maxFeePerGas: string | number | null;
  sessionId: string | null;
  valid: boolean | null;
  executed: boolean | null;
  sessionAlive: boolean | null;
}

export function hasTransactionDb(): boolean {
  return hasExplorerDbConfig();
}

export function normalizeTransactionLimit(limit: number | undefined, fallback = DEFAULT_LIMIT): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), MAX_LIMIT);
}

function normalizePage(page: number | undefined): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(Math.trunc(page ?? 1), 1);
}

function offsetFor(page: number | undefined, limit: number): number {
  return (normalizePage(page) - 1) * limit;
}

function normalizeWindowHours(windowHours: number | undefined, fallback = DEFAULT_RECENT_WINDOW_HOURS): number {
  if (!Number.isFinite(windowHours)) return fallback;
  return Math.max(Math.trunc(windowHours ?? fallback), 0);
}

function toIso(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

function decimalString(value: string | undefined, fallback: string): string {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Wei values must be non-negative decimal strings.');
  return value;
}

let transactionColumns: Promise<TransactionColumns> | undefined;

async function getTransactionColumns(): Promise<TransactionColumns> {
  transactionColumns ??= explorerDbQuery<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'transactions'
    `
  ).then((result) => {
    const columns = new Set(result.rows.map((row) => row.column_name));
    const firstColumn = (...names: string[]): string | null => names.find((name) => columns.has(name)) ?? null;
    return {
      hasNonce: columns.has('nonce'),
      hasType: columns.has('type'),
      gasColumn: firstColumn('gas_limit', 'gas'),
      gasPriceColumn: firstColumn('gas_price'),
      maxPriorityFeePerGasColumn: firstColumn('max_priority_fee_per_gas', 'maxPriorityFeePerGas'),
      maxFeePerGasColumn: firstColumn('max_fee_per_gas', 'maxFeePerGas')
    };
  });
  return transactionColumns;
}

function quoteIdent(identifier: string): string {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

function optionalColumn(column: string | null, alias: string): string {
  return column ? `t.${quoteIdent(column)} AS ${alias}` : `NULL AS ${alias}`;
}

async function transactionSelectList(): Promise<string> {
  const columns = await getTransactionColumns();
  return [
    't.hash',
    't.block_number',
    'b.block_timestamp',
    't.transaction_index',
    't.from_address',
    't.to_address',
    't.input_data',
    't.value',
    columns.hasNonce ? 't.nonce' : 'NULL AS nonce',
    columns.hasType ? 't.type' : 'NULL AS type',
    optionalColumn(columns.gasColumn, 'gas_limit'),
    optionalColumn(columns.gasPriceColumn, 'gas_price'),
    optionalColumn(columns.maxPriorityFeePerGasColumn, 'max_priority_fee_per_gas'),
    optionalColumn(columns.maxFeePerGasColumn, 'max_fee_per_gas'),
    't.session_id',
    't.valid',
    't.executed',
    't.session_alive'
  ].join(',\n        ');
}

function addBlockFilters(input: { fromBlock?: number; toBlock?: number }, where: string[], params: unknown[]): void {
  if (input.fromBlock !== undefined) {
    params.push(Math.trunc(input.fromBlock));
    where.push(`t.block_number >= $${params.length}`);
  }
  if (input.toBlock !== undefined) {
    params.push(Math.trunc(input.toBlock));
    where.push(`t.block_number <= $${params.length}`);
  }
}

function addWindowFilter(windowHours: number | undefined, where: string[], params: unknown[], fallback?: number): void {
  const hours = normalizeWindowHours(windowHours, fallback);
  if (hours <= 0) return;
  params.push(hours);
  where.push(`b.block_timestamp >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`);
}

function addAddressFilter(column: 'from_address' | 'to_address', address: string | undefined, where: string[], params: unknown[]): void {
  if (!address) return;
  params.push(address.toLowerCase());
  where.push(`LOWER(t.${column}) = $${params.length}`);
}

function mapTransaction(row: TransactionRow): NormalizedTransaction {
  return {
    hash: row.hash,
    blockNumber: row.block_number,
    blockTimestamp: toIso(row.block_timestamp),
    transactionIndex: row.transaction_index,
    from: row.from_address,
    to: row.to_address,
    valueWei: row.value,
    inputData: row.input_data,
    nonce: row.nonce,
    type: row.type,
    gasLimit: row.gas_limit,
    gasPrice: row.gas_price,
    maxPriorityFeePerGas: row.max_priority_fee_per_gas,
    maxFeePerGas: row.max_fee_per_gas,
    sessionId: row.session_id,
    valid: row.valid,
    executed: row.executed,
    sessionAlive: row.session_alive
  };
}

async function listTransactions(where: string[], params: unknown[], page: number | undefined, limit: number | undefined): Promise<NormalizedTransaction[]> {
  const max = normalizeTransactionLimit(limit);
  const selectList = await transactionSelectList();
  params.push(max);
  const limitParam = params.length;
  params.push(offsetFor(page, max));
  const offsetParam = params.length;
  const result = await explorerDbQuery<TransactionRow>(
    `
      SELECT
        ${selectList}
      FROM transactions t
      LEFT JOIN blocks b ON b.block_number = t.block_number
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.block_number DESC, t.transaction_index DESC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    params
  );
  return result.rows.map(mapTransaction);
}

export async function searchTransactionsDb(input: SearchTransactionsInput): Promise<NormalizedTransaction[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  addAddressFilter('from_address', input.from, where, params);
  addAddressFilter('to_address', input.to, where, params);
  if (input.txHash) {
    params.push(input.txHash.toLowerCase());
    where.push('LOWER(t.hash) = $' + params.length);
  }
  if (input.valueGtWei !== undefined) {
    params.push(decimalString(input.valueGtWei, '0'));
    where.push(`t.value::numeric > $${params.length}::numeric`);
  }
  if (input.valueEqWei !== undefined) {
    params.push(decimalString(input.valueEqWei, '0'));
    where.push(`t.value::numeric = $${params.length}::numeric`);
  }
  if (input.valueLtWei !== undefined) {
    params.push(decimalString(input.valueLtWei, '0'));
    where.push(`t.value::numeric < $${params.length}::numeric`);
  }
  if (input.hasValue === true) where.push('t.value::numeric > 0');
  if (input.hasValue === false) where.push('t.value::numeric = 0');
  if (input.hasInput === true) where.push("t.input_data IS NOT NULL AND t.input_data <> '' AND t.input_data <> '0x'");
  if (input.hasInput === false) where.push("(t.input_data IS NULL OR t.input_data = '' OR t.input_data = '0x')");
  if (input.contractCreation === true) where.push('t.to_address IS NULL');
  if (input.contractCreation === false) where.push('t.to_address IS NOT NULL');
  if (input.sessionId) {
    params.push(input.sessionId);
    where.push(`t.session_id = $${params.length}`);
  }
  if (input.valid !== undefined) {
    params.push(input.valid);
    where.push(`t.valid = $${params.length}`);
  }
  if (input.executed !== undefined) {
    params.push(input.executed);
    where.push(`t.executed = $${params.length}`);
  }
  if (input.windowHours !== undefined) addWindowFilter(input.windowHours, where, params, 0);
  addBlockFilters(input, where, params);
  return listTransactions(where, params, input.page, input.limit);
}

export async function getRecentValueTransfersDb(input: GetRecentValueTransfersInput) {
  const where = ['t.value::numeric > $1::numeric'];
  const params: unknown[] = [decimalString(input.minValueWei, '0')];
  addAddressFilter('from_address', input.from, where, params);
  addAddressFilter('to_address', input.to, where, params);
  const windowHours = normalizeWindowHours(input.windowHours, DEFAULT_RECENT_WINDOW_HOURS);
  addWindowFilter(windowHours, where, params, DEFAULT_RECENT_WINDOW_HOURS);
  const transfers = await listTransactions(where, params, input.page, input.limit);
  const totalValueWeiReturned = transfers.reduce((sum, tx) => sum + BigInt(String(tx.valueWei ?? '0')), 0n).toString();
  return {
    windowHours,
    countReturned: transfers.length,
    totalValueWeiReturned,
    transfers
  };
}

export async function getAccountTransactionsDb(input: GetAccountTransactionsInput): Promise<NormalizedTransaction[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const address = input.address.toLowerCase();
  const direction = input.direction ?? 'both';
  if (direction === 'out') {
    params.push(address);
    where.push(`LOWER(t.from_address) = $${params.length}`);
  } else if (direction === 'in') {
    params.push(address);
    where.push(`LOWER(t.to_address) = $${params.length}`);
  } else {
    params.push(address);
    where.push(`(LOWER(t.from_address) = $${params.length} OR LOWER(t.to_address) = $${params.length})`);
  }
  if (input.valueOnly) where.push('t.value::numeric > 0');
  if (input.windowHours !== undefined) addWindowFilter(input.windowHours, where, params, 0);
  return listTransactions(where, params, input.page, input.limit);
}

export async function getBlockTransactionsDb(input: GetBlockTransactionsInput) {
  let blockNumber = input.blockNumber;
  if (blockNumber === undefined) {
    const latest = await explorerDbQuery<LatestBlockRow>(
      `
        SELECT block_number, block_timestamp
        FROM blocks
        ORDER BY block_number DESC
        LIMIT 1
      `
    );
    const latestBlock = Number(latest.rows[0]?.block_number ?? 0);
    blockNumber = latestBlock - Math.max(Math.trunc(input.latestOffset ?? 0), 0);
  }
  const where = ['t.block_number = $1'];
  const params: unknown[] = [Math.trunc(blockNumber)];
  const transactions = await listTransactions(where, params, input.page, input.limit);
  const block = await explorerDbQuery<LatestBlockRow>(
    `
      SELECT block_number, block_timestamp
      FROM blocks
      WHERE block_number = $1
      LIMIT 1
    `,
    [Math.trunc(blockNumber)]
  );
  return {
    blockNumber: block.rows[0]?.block_number ?? blockNumber,
    blockTimestamp: toIso(block.rows[0]?.block_timestamp ?? null),
    countReturned: transactions.length,
    transactions
  };
}

export async function getTransactionStatsDb(input: GetTransactionStatsInput) {
  const where: string[] = [];
  const params: unknown[] = [];
  const joinBlocks = input.windowHours !== undefined;
  if (input.windowHours !== undefined) addWindowFilter(input.windowHours, where, params, 0);
  addBlockFilters(input, where, params);
  const result = await explorerDbQuery<StatsRow>(
    `
      SELECT
        COUNT(*)::text AS total_transactions,
        COUNT(*) FILTER (WHERE t.value::numeric > 0)::text AS value_transfer_count,
        COUNT(*) FILTER (WHERE t.value::numeric = 0)::text AS zero_value_count,
        COUNT(*) FILTER (WHERE t.to_address IS NULL)::text AS contract_creation_count,
        COALESCE(SUM(t.value::numeric), 0)::text AS total_value_wei,
        MIN(t.block_number) AS first_block,
        MAX(t.block_number) AS last_block
      FROM transactions t
      ${joinBlocks ? 'JOIN blocks b ON b.block_number = t.block_number' : ''}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    `,
    params
  );
  const row = result.rows[0];
  return {
    totalTransactions: row?.total_transactions ?? '0',
    valueTransferCount: row?.value_transfer_count ?? '0',
    zeroValueCount: row?.zero_value_count ?? '0',
    contractCreationCount: row?.contract_creation_count ?? '0',
    totalValueWei: row?.total_value_wei ?? '0',
    firstBlock: row?.first_block ?? null,
    lastBlock: row?.last_block ?? null
  };
}

export async function safeTransactionDb<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  if (!hasTransactionDb()) return { ok: false, message: 'Explorer read-only database is not configured (PGRO_* missing).' };
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
