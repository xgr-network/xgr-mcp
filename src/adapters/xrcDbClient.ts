import { explorerDbQuery, hasExplorerDbConfig } from './explorerDbClient.js';

export type XrcType = 'xrc137' | 'xrc729';
export type XrcAction = 'deploy' | 'update' | 'ostc_update' | 'ostc_delete';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const DEFAULT_WINDOW_HOURS = 24 * 14;

export function normalizeXrcLimit(limit: number | undefined, fallback = DEFAULT_LIMIT): number {
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

function normalizeWindowHours(windowHours: number | undefined): number {
  if (!Number.isFinite(windowHours)) return DEFAULT_WINDOW_HOURS;
  return Math.max(Math.trunc(windowHours ?? DEFAULT_WINDOW_HOURS), 0);
}

function buildWindowWhere(column: string, windowHours: number | undefined, params: unknown[]): string[] {
  const hours = normalizeWindowHours(windowHours);
  if (hours <= 0) return [];
  params.push(hours);
  return [`${column} >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`];
}

function jsonParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isPgMissingColumn(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '42703';
}

interface ContractRow {
  contract_address: string | null;
  xrc_type: string | null;
  owner: string | null;
  name_xrc: string | null;
  schema_version: string | number | null;
  first_seen_block: string | number | null;
  first_seen_tx_hash: string | null;
  first_seen_log_index: string | number | null;
  last_seen_block: string | number | null;
  last_event_tx_hash: string | null;
  last_event_log_index: string | number | null;
  rule_hash: string | null;
  rule_version: string | number | null;
  encrypted_state: boolean | null;
  name_hash: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface EventRow {
  tx_hash: string | null;
  log_index: string | number | null;
  block_number: string | number | null;
  block_timestamp: Date | string | null;
  contract_address: string | null;
  xrc_type: string | null;
  event_name: string | null;
  action: string | null;
  owner: string | null;
  topic0: string | null;
  rule_hash: string | null;
  rule_version: string | number | null;
  encrypted_state: boolean | null;
  name_xrc: string | null;
  schema_version: string | number | null;
  name_hash: string | null;
  ostc_id: string | null;
  ostc_id_hash: string | null;
  ostc_hash: string | null;
  previous_ostc_hash: string | null;
  ostc_version: string | number | null;
  previous_ostc_version: string | number | null;
  ostc_updated_at: Date | string | null;
  args: unknown;
  created_at: Date | string | null;
}

interface OstcRow {
  xrc729_address: string | null;
  ostc_id: string | null;
  ostc_id_hash: string | null;
  ostc_hash: string | null;
  version: string | number | null;
  updated_at: Date | string | null;
  deleted: boolean | null;
  last_tx_hash: string | null;
  last_block: string | number | null;
  last_log_index: string | number | null;
  updated_db_at: Date | string | null;
}

interface UsageAggregateRow {
  total_receipt_rows: string | null;
  unique_sessions: string | null;
  valid_count: string | null;
  invalid_count: string | null;
  first_block: string | number | null;
  last_block: string | number | null;
  step_ids: string[] | null;
}

interface RecentSessionRow {
  owner: string | null;
  session_id: string | null;
  first_block: string | number | null;
  last_block: string | number | null;
  valid_count: string | null;
  invalid_count: string | null;
  step_ids: string[] | null;
  last_tx_hash: string | null;
  latest_payload: unknown;
  last_seen_at: Date | string | null;
}

interface FailureCountRow {
  total: string | null;
  invalid: string | null;
  valid: string | null;
}

interface FailingStepRow {
  step_id: string | null;
  invalid: string | null;
  total: string | null;
}

interface FailingRuleRow {
  rule_contract: string | null;
  rule_hash: string | null;
  invalid: string | null;
  total: string | null;
}

export interface ListXrcContractsDbInput {
  owner?: string;
  type?: XrcType;
  page?: number;
  limit?: number;
}

export interface ListXrcEventsDbInput {
  owner?: string;
  contract?: string;
  type?: XrcType;
  action?: XrcAction;
  txHash?: string;
  fromBlock?: number;
  toBlock?: number;
  page?: number;
  limit?: number;
}

export interface XrcUsageInput {
  address: string;
  type?: XrcType;
  ostcId?: string;
  ostcHash?: string;
  windowHours?: number;
  limit?: number;
}

export interface XrcProcessSessionsInput {
  xrc729Address?: string;
  ostcId?: string;
  ostcHash?: string;
  owner?: string;
  windowHours?: number;
  page?: number;
  limit?: number;
}

export interface XrcFailureStatsInput {
  address?: string;
  type?: XrcType;
  ostcId?: string;
  ostcHash?: string;
  owner?: string;
  windowHours?: number;
  limit?: number;
}

export function hasXrcDb(): boolean {
  return hasExplorerDbConfig();
}

function toIso(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

export function mapDbContract(row: ContractRow) {
  return {
    contractAddress: row.contract_address,
    xrcType: row.xrc_type,
    owner: row.owner,
    nameXrc: row.name_xrc,
    schemaVersion: row.schema_version,
    firstSeenBlock: row.first_seen_block,
    firstSeenTxHash: row.first_seen_tx_hash,
    firstSeenLogIndex: row.first_seen_log_index,
    lastSeenBlock: row.last_seen_block,
    lastEventTxHash: row.last_event_tx_hash,
    lastEventLogIndex: row.last_event_log_index,
    ruleHash: row.rule_hash,
    ruleVersion: row.rule_version,
    encryptedState: row.encrypted_state,
    nameHash: row.name_hash,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export function mapDbEvent(row: EventRow) {
  return {
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: row.block_number,
    blockTimestamp: toIso(row.block_timestamp),
    contractAddress: row.contract_address,
    xrcType: row.xrc_type,
    eventName: row.event_name,
    action: row.action,
    owner: row.owner,
    topic0: row.topic0,
    ruleHash: row.rule_hash,
    ruleVersion: row.rule_version,
    encryptedState: row.encrypted_state,
    nameXrc: row.name_xrc,
    schemaVersion: row.schema_version,
    nameHash: row.name_hash,
    ostcId: row.ostc_id,
    ostcIdHash: row.ostc_id_hash,
    ostcHash: row.ostc_hash,
    previousOstcHash: row.previous_ostc_hash,
    ostcVersion: row.ostc_version,
    previousOstcVersion: row.previous_ostc_version,
    ostcUpdatedAt: toIso(row.ostc_updated_at),
    args: jsonParse(row.args),
    createdAt: toIso(row.created_at)
  };
}

export function mapDbOstc(row: OstcRow) {
  return {
    xrc729Address: row.xrc729_address,
    ostcId: row.ostc_id,
    ostcIdHash: row.ostc_id_hash,
    ostcHash: row.ostc_hash,
    version: row.version,
    updatedAt: toIso(row.updated_at),
    deleted: row.deleted,
    lastTxHash: row.last_tx_hash,
    lastBlock: row.last_block,
    lastLogIndex: row.last_log_index,
    updatedDbAt: toIso(row.updated_db_at)
  };
}

export async function listXrcContractsDb(input: ListXrcContractsDbInput = {}) {
  const limit = normalizeXrcLimit(input.limit);
  const params: unknown[] = [];
  const where: string[] = [];
  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`LOWER(owner) = $${params.length}`);
  }
  if (input.type) {
    params.push(input.type);
    where.push(`xrc_type = $${params.length}`);
  }
  params.push(limit, offsetFor(input.page, limit));
  const result = await explorerDbQuery<ContractRow>(
    `
      SELECT contract_address, xrc_type, owner, name_xrc, schema_version, first_seen_block,
        first_seen_tx_hash, first_seen_log_index, last_seen_block, last_event_tx_hash,
        last_event_log_index, rule_hash, rule_version, encrypted_state, name_hash, created_at, updated_at
      FROM xrc_contracts
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY last_seen_block DESC NULLS LAST, updated_at DESC NULLS LAST, contract_address ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return result.rows.map(mapDbContract);
}

export async function getXrcContractDb(address: string) {
  const result = await explorerDbQuery<ContractRow>(
    `
      SELECT contract_address, xrc_type, owner, name_xrc, schema_version, first_seen_block,
        first_seen_tx_hash, first_seen_log_index, last_seen_block, last_event_tx_hash,
        last_event_log_index, rule_hash, rule_version, encrypted_state, name_hash, created_at, updated_at
      FROM xrc_contracts
      WHERE LOWER(contract_address) = LOWER($1)
      LIMIT 1
    `,
    [address]
  );
  return result.rows[0] ? mapDbContract(result.rows[0]) : null;
}

export async function listXrcEventsDb(input: ListXrcEventsDbInput = {}) {
  const limit = normalizeXrcLimit(input.limit);
  const params: unknown[] = [];
  const where: string[] = [];
  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`LOWER(owner) = $${params.length}`);
  }
  if (input.contract) {
    params.push(input.contract.toLowerCase());
    where.push(`LOWER(contract_address) = $${params.length}`);
  }
  if (input.type) {
    params.push(input.type);
    where.push(`xrc_type = $${params.length}`);
  }
  if (input.action) {
    params.push(input.action);
    where.push(`action = $${params.length}`);
  }
  if (input.txHash) {
    params.push(input.txHash.toLowerCase());
    where.push(`LOWER(tx_hash) = $${params.length}`);
  }
  if (input.fromBlock !== undefined) {
    params.push(input.fromBlock);
    where.push(`block_number >= $${params.length}`);
  }
  if (input.toBlock !== undefined) {
    params.push(input.toBlock);
    where.push(`block_number <= $${params.length}`);
  }
  params.push(limit, offsetFor(input.page, limit));
  const result = await explorerDbQuery<EventRow>(
    `
      SELECT tx_hash, log_index, block_number, block_timestamp, contract_address, xrc_type,
        event_name, action, owner, topic0, rule_hash, rule_version, encrypted_state,
        name_xrc, schema_version, name_hash, ostc_id, ostc_id_hash, ostc_hash,
        previous_ostc_hash, ostc_version, previous_ostc_version, ostc_updated_at, args, created_at
      FROM xrc_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY block_number DESC NULLS LAST, log_index DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return result.rows.map(mapDbEvent);
}

export async function listXrc729OstcStateDb(address: string, includeDeleted = false, page?: number, limitInput?: number) {
  const limit = normalizeXrcLimit(limitInput);
  const params: unknown[] = [address.toLowerCase()];
  const where = ['LOWER(xrc729_address) = $1'];
  if (!includeDeleted) where.push('deleted IS DISTINCT FROM TRUE');
  params.push(limit, offsetFor(page, limit));
  const result = await explorerDbQuery<OstcRow>(
    `
      SELECT xrc729_address, ostc_id, ostc_id_hash, ostc_hash, version, updated_at, deleted,
        last_tx_hash, last_block, last_log_index, updated_db_at
      FROM xrc729_ostc_state
      WHERE ${where.join(' AND ')}
      ORDER BY last_block DESC NULLS LAST, last_log_index DESC NULLS LAST, version DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return result.rows.map(mapDbOstc);
}

function mapUsageAggregate(row: UsageAggregateRow | undefined, recentSessions: RecentSessionRow[]) {
  return {
    usageKnown: Boolean(row),
    totalReceiptRows: row?.total_receipt_rows ?? '0',
    uniqueSessions: row?.unique_sessions ?? '0',
    validCount: row?.valid_count ?? '0',
    invalidCount: row?.invalid_count ?? '0',
    firstBlock: row?.first_block ?? null,
    lastBlock: row?.last_block ?? null,
    stepIds: row?.step_ids ?? [],
    recentSessions: recentSessions.map((session) => ({
      owner: session.owner,
      sessionId: session.session_id,
      firstBlock: session.first_block,
      lastBlock: session.last_block,
      validCount: session.valid_count ?? '0',
      invalidCount: session.invalid_count ?? '0',
      stepIds: session.step_ids ?? [],
      lastTxHash: session.last_tx_hash,
      latestPayload: jsonParse(session.latest_payload),
      lastSeenAt: toIso(session.last_seen_at)
    }))
  };
}

function buildReceiptWhereForUsage(input: XrcUsageInput, params: unknown[]): string[] {
  const where = buildWindowWhere('updated_at', input.windowHours, params);
  const type = input.type;
  if (type === 'xrc137' || (!type && !input.ostcId && !input.ostcHash)) {
    params.push(input.address.toLowerCase());
    where.push(`LOWER(engine_rule_contract) = $${params.length}`);
  } else {
    if (input.ostcId) {
      params.push(input.ostcId);
      where.push(`engine_ostc_id = $${params.length}`);
    }
    if (input.ostcHash) {
      params.push(input.ostcHash.toLowerCase());
      where.push(`LOWER(engine_ostc_hash) = $${params.length}`);
    }
    if (!input.ostcId && !input.ostcHash) {
      params.push(`%${input.address.toLowerCase()}%`);
      where.push(`LOWER(engine_orchestration::text) LIKE $${params.length}`);
    }
  }
  return where;
}

export async function getXrcUsageDb(input: XrcUsageInput) {
  const limit = normalizeXrcLimit(input.limit);
  const aggregateParams: unknown[] = [];
  const where = buildReceiptWhereForUsage(input, aggregateParams);
  const aggregate = await explorerDbQuery<UsageAggregateRow>(
    `
      SELECT COUNT(*)::bigint AS total_receipt_rows,
        COUNT(DISTINCT COALESCE(receipt_from_address, '') || ':' || COALESCE(engine_session_id, ''))::bigint AS unique_sessions,
        COUNT(*) FILTER (WHERE engine_valid IS TRUE)::bigint AS valid_count,
        COUNT(*) FILTER (WHERE engine_valid IS DISTINCT FROM TRUE)::bigint AS invalid_count,
        MIN(block_number) AS first_block,
        MAX(block_number) AS last_block,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT engine_step_id), NULL) AS step_ids
      FROM tx_receipts
      WHERE ${where.join(' AND ')}
    `,
    aggregateParams
  );

  const recentParams: unknown[] = [];
  const recentWhere = buildReceiptWhereForUsage(input, recentParams);
  recentParams.push(limit);
  const recent = await explorerDbQuery<RecentSessionRow>(
    `
      SELECT receipt_from_address AS owner, engine_session_id AS session_id,
        MIN(block_number) AS first_block,
        MAX(block_number) AS last_block,
        COUNT(*) FILTER (WHERE engine_valid IS TRUE)::bigint AS valid_count,
        COUNT(*) FILTER (WHERE engine_valid IS DISTINCT FROM TRUE)::bigint AS invalid_count,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT engine_step_id), NULL) AS step_ids,
        (ARRAY_AGG(tx_hash ORDER BY block_number DESC NULLS LAST, updated_at DESC NULLS LAST))[1] AS last_tx_hash,
        (ARRAY_AGG(engine_payload ORDER BY block_number DESC NULLS LAST, updated_at DESC NULLS LAST))[1] AS latest_payload,
        MAX(updated_at) AS last_seen_at
      FROM tx_receipts
      WHERE ${recentWhere.join(' AND ')}
      GROUP BY receipt_from_address, engine_session_id
      ORDER BY last_seen_at DESC NULLS LAST
      LIMIT $${recentParams.length}
    `,
    recentParams
  );

  return mapUsageAggregate(aggregate.rows[0], recent.rows);
}

export async function listXrcProcessSessionsDb(input: XrcProcessSessionsInput) {
  const limit = normalizeXrcLimit(input.limit);
  const params: unknown[] = [];
  const where = buildWindowWhere('updated_at', input.windowHours, params);
  if (input.ostcId) {
    params.push(input.ostcId);
    where.push(`engine_ostc_id = $${params.length}`);
  }
  if (input.ostcHash) {
    params.push(input.ostcHash.toLowerCase());
    where.push(`LOWER(engine_ostc_hash) = $${params.length}`);
  }
  if (input.xrc729Address) {
    params.push(`%${input.xrc729Address.toLowerCase()}%`);
    where.push(`LOWER(engine_orchestration::text) LIKE $${params.length}`);
  }
  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`LOWER(receipt_from_address) = $${params.length}`);
  }
  params.push(limit, offsetFor(input.page, limit));
  const result = await explorerDbQuery<RecentSessionRow>(
    `
      SELECT receipt_from_address AS owner, engine_session_id AS session_id,
        MIN(block_number) AS first_block,
        MAX(block_number) AS last_block,
        COUNT(*) FILTER (WHERE engine_valid IS TRUE)::bigint AS valid_count,
        COUNT(*) FILTER (WHERE engine_valid IS DISTINCT FROM TRUE)::bigint AS invalid_count,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT engine_step_id), NULL) AS step_ids,
        (ARRAY_AGG(tx_hash ORDER BY block_number DESC NULLS LAST, updated_at DESC NULLS LAST))[1] AS last_tx_hash,
        (ARRAY_AGG(engine_payload ORDER BY block_number DESC NULLS LAST, updated_at DESC NULLS LAST))[1] AS latest_payload,
        MAX(updated_at) AS last_seen_at
      FROM tx_receipts
      WHERE ${where.join(' AND ')}
      GROUP BY receipt_from_address, engine_session_id
      ORDER BY last_seen_at DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return result.rows.map((session) => ({
    owner: session.owner,
    sessionId: session.session_id,
    firstBlock: session.first_block,
    lastBlock: session.last_block,
    validCount: session.valid_count ?? '0',
    invalidCount: session.invalid_count ?? '0',
    stepIds: session.step_ids ?? [],
    lastTxHash: session.last_tx_hash,
    latestPayload: jsonParse(session.latest_payload),
    lastSeenAt: toIso(session.last_seen_at)
  }));
}

export async function listUnusedXrc137RulesDb(owner: string, limitInput?: number) {
  const limit = normalizeXrcLimit(limitInput);
  const result = await explorerDbQuery<ContractRow>(
    `
      SELECT c.contract_address, c.xrc_type, c.owner, c.name_xrc, c.schema_version, c.first_seen_block,
        c.first_seen_tx_hash, c.first_seen_log_index, c.last_seen_block, c.last_event_tx_hash,
        c.last_event_log_index, c.rule_hash, c.rule_version, c.encrypted_state, c.name_hash,
        c.created_at, c.updated_at
      FROM xrc_contracts c
      LEFT JOIN tx_receipts r ON LOWER(r.engine_rule_contract) = LOWER(c.contract_address)
      WHERE LOWER(c.owner) = LOWER($1) AND c.xrc_type = 'xrc137'
      GROUP BY c.contract_address, c.xrc_type, c.owner, c.name_xrc, c.schema_version,
        c.first_seen_block, c.first_seen_tx_hash, c.first_seen_log_index, c.last_seen_block,
        c.last_event_tx_hash, c.last_event_log_index, c.rule_hash, c.rule_version,
        c.encrypted_state, c.name_hash, c.created_at, c.updated_at
      HAVING COUNT(r.tx_hash) = 0
      ORDER BY c.last_seen_block DESC NULLS LAST, c.updated_at DESC NULLS LAST
      LIMIT $2
    `,
    [owner.toLowerCase(), limit]
  );
  return result.rows.map(mapDbContract);
}

function buildFailureWhere(input: XrcFailureStatsInput, params: unknown[]): string[] {
  const where = buildWindowWhere('updated_at', input.windowHours, params);
  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`LOWER(receipt_from_address) = $${params.length}`);
  }
  if (input.address && input.type === 'xrc137') {
    params.push(input.address.toLowerCase());
    where.push(`LOWER(engine_rule_contract) = $${params.length}`);
  }
  if (input.address && input.type === 'xrc729') {
    params.push(`%${input.address.toLowerCase()}%`);
    where.push(`LOWER(engine_orchestration::text) LIKE $${params.length}`);
  }
  if (input.address && !input.type) {
    params.push(input.address.toLowerCase(), `%${input.address.toLowerCase()}%`);
    where.push(`(LOWER(engine_rule_contract) = $${params.length - 1} OR LOWER(engine_orchestration::text) LIKE $${params.length})`);
  }
  if (input.ostcId) {
    params.push(input.ostcId);
    where.push(`engine_ostc_id = $${params.length}`);
  }
  if (input.ostcHash) {
    params.push(input.ostcHash.toLowerCase());
    where.push(`LOWER(engine_ostc_hash) = $${params.length}`);
  }
  return where.length > 0 ? where : ['TRUE'];
}

export async function getXrcFailureStatsDb(input: XrcFailureStatsInput) {
  const limit = normalizeXrcLimit(input.limit, 10);
  const countParams: unknown[] = [];
  const where = buildFailureWhere(input, countParams);
  const counts = await explorerDbQuery<FailureCountRow>(
    `
      SELECT COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE engine_valid IS DISTINCT FROM TRUE)::bigint AS invalid,
        COUNT(*) FILTER (WHERE engine_valid IS TRUE)::bigint AS valid
      FROM tx_receipts
      WHERE ${where.join(' AND ')}
    `,
    countParams
  );

  const topStepsParams: unknown[] = [];
  const topStepsWhere = buildFailureWhere(input, topStepsParams);
  topStepsParams.push(limit);
  const topSteps = await explorerDbQuery<FailingStepRow>(
    `
      SELECT engine_step_id AS step_id,
        COUNT(*) FILTER (WHERE engine_valid IS DISTINCT FROM TRUE)::bigint AS invalid,
        COUNT(*)::bigint AS total
      FROM tx_receipts
      WHERE ${topStepsWhere.join(' AND ')}
      GROUP BY engine_step_id
      ORDER BY invalid DESC, total DESC
      LIMIT $${topStepsParams.length}
    `,
    topStepsParams
  );

  const topRulesParams: unknown[] = [];
  const topRulesWhere = buildFailureWhere(input, topRulesParams);
  topRulesParams.push(limit);
  const topRules = await explorerDbQuery<FailingRuleRow>(
    `
      SELECT engine_rule_contract AS rule_contract, engine_rule_hash AS rule_hash,
        COUNT(*) FILTER (WHERE engine_valid IS DISTINCT FROM TRUE)::bigint AS invalid,
        COUNT(*)::bigint AS total
      FROM tx_receipts
      WHERE ${topRulesWhere.join(' AND ')}
      GROUP BY engine_rule_contract, engine_rule_hash
      ORDER BY invalid DESC, total DESC
      LIMIT $${topRulesParams.length}
    `,
    topRulesParams
  );

  const recentParams: unknown[] = [];
  const recentWhere = buildFailureWhere(input, recentParams);
  recentWhere.push('engine_valid IS DISTINCT FROM TRUE');
  recentParams.push(limit);
  const recentInvalid = await explorerDbQuery<RecentSessionRow>(
    `
      SELECT receipt_from_address AS owner, engine_session_id AS session_id,
        MIN(block_number) AS first_block,
        MAX(block_number) AS last_block,
        COUNT(*) FILTER (WHERE engine_valid IS TRUE)::bigint AS valid_count,
        COUNT(*) FILTER (WHERE engine_valid IS DISTINCT FROM TRUE)::bigint AS invalid_count,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT engine_step_id), NULL) AS step_ids,
        (ARRAY_AGG(tx_hash ORDER BY block_number DESC NULLS LAST, updated_at DESC NULLS LAST))[1] AS last_tx_hash,
        (ARRAY_AGG(engine_payload ORDER BY block_number DESC NULLS LAST, updated_at DESC NULLS LAST))[1] AS latest_payload,
        MAX(updated_at) AS last_seen_at
      FROM tx_receipts
      WHERE ${recentWhere.join(' AND ')}
      GROUP BY receipt_from_address, engine_session_id
      ORDER BY last_seen_at DESC NULLS LAST
      LIMIT $${recentParams.length}
    `,
    recentParams
  );

  const row = counts.rows[0];
  const total = Number(row?.total ?? 0);
  const invalid = Number(row?.invalid ?? 0);
  return {
    total: row?.total ?? '0',
    invalid: row?.invalid ?? '0',
    valid: row?.valid ?? '0',
    invalidRate: total > 0 ? invalid / total : 0,
    topFailingSteps: topSteps.rows.map((step) => ({ stepId: step.step_id, invalid: step.invalid ?? '0', total: step.total ?? '0' })),
    topFailingRules: topRules.rows.map((rule) => ({
      ruleContract: rule.rule_contract,
      ruleHash: rule.rule_hash,
      invalid: rule.invalid ?? '0',
      total: rule.total ?? '0'
    })),
    recentInvalidSessions: recentInvalid.rows.map((session) => ({
      owner: session.owner,
      sessionId: session.session_id,
      firstBlock: session.first_block,
      lastBlock: session.last_block,
      invalidCount: session.invalid_count ?? '0',
      stepIds: session.step_ids ?? [],
      lastTxHash: session.last_tx_hash,
      latestPayload: jsonParse(session.latest_payload),
      lastSeenAt: toIso(session.last_seen_at)
    }))
  };
}

export async function safeDb<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  if (!hasXrcDb()) return { ok: false, message: 'Explorer read-only database is not configured (PGRO_* missing).' };
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const suffix = isPgMissingColumn(error) ? ' A referenced Explorer DB column is not available in this schema.' : '';
    return { ok: false, message: `${error instanceof Error ? error.message : String(error)}${suffix}` };
  }
}
