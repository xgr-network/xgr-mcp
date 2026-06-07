import { explorerDbQuery } from './explorerDbClient.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const DEFAULT_WINDOW_HOURS = 24;

export interface FindRecentXdalaSessionsInput {
  owner?: string;
  limit?: number;
  windowHours?: number;
  includePayload?: boolean;
}

interface SessionRow {
  owner: string | null;
  session_id: string | null;
  started_at: Date | string | null;
  last_seen_at: Date | string | null;
  duration_s: string | number | null;
  steps_total: string | number | null;
  steps_ok: string | number | null;
  steps_fail: string | number | null;
  steps_unknown: string | number | null;
  session_outcome: string | null;
  final_tx_hash: string | null;
  final_receipt_status: number | null;
  final_engine_valid: boolean | null;
  final_exec_result: boolean | null;
  orchestration_any: string | null;
  exec_contract_any: string | null;
  rule_contract_any: string | null;
  fees_total: string | null;
  tx_gas_total: string | null;
  inner_gas_total: string | null;
}

interface PayloadRow {
  tx_hash: string;
  engine_payload: unknown;
  engine_api_saves: unknown;
  engine_contract_saves: unknown;
  engine_extras: unknown;
  engine_step_id: string | null;
  engine_iteration: string | null;
  engine_ostc_id: string | null;
  engine_ostc_hash: string | null;
  engine_rule_contract: string | null;
  engine_exec_contract: string | null;
  engine_valid: boolean | null;
  updated_at: Date | string | null;
  block_number: string | null;
}

export interface XdalaSessionSummary {
  owner: string | null;
  sessionId: string | null;
  startedAt: string | null;
  lastSeenAt: string | null;
  durationS: string | number | null;
  stepsTotal: string | number | null;
  stepsOk: string | number | null;
  stepsFail: string | number | null;
  stepsUnknown: string | number | null;
  sessionOutcome: string | null;
  finalTxHash: string | null;
  finalReceiptStatus: number | null;
  finalEngineValid: boolean | null;
  finalExecResult: boolean | null;
  orchestration: string | null;
  execContract: string | null;
  ruleContract: string | null;
  feesTotal: string | null;
  txGasTotal: string | null;
  innerGasTotal: string | null;
}

export interface XdalaSessionWithPayload extends XdalaSessionSummary {
  payload?: unknown;
  apiSaves?: unknown;
  contractSaves?: unknown;
  extras?: unknown;
  finalStepId?: string | null;
  finalIteration?: string | null;
  ostcId?: string | null;
  ostcHash?: string | null;
  finalRuleContract?: string | null;
  finalExecContract?: string | null;
  finalReceiptEngineValid?: boolean | null;
  receiptUpdatedAt?: string | null;
  finalBlockNumber?: string | null;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
}

function normalizeWindowHours(windowHours: number | undefined): number {
  if (!Number.isFinite(windowHours)) return DEFAULT_WINDOW_HOURS;
  return Math.max(Math.trunc(windowHours ?? DEFAULT_WINDOW_HOURS), 0);
}

function toIsoString(value: Date | string | null): string | null {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function parseJsonb(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapSessionRow(row: SessionRow): XdalaSessionSummary {
  return {
    owner: row.owner,
    sessionId: row.session_id,
    startedAt: toIsoString(row.started_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    durationS: row.duration_s,
    stepsTotal: row.steps_total,
    stepsOk: row.steps_ok,
    stepsFail: row.steps_fail,
    stepsUnknown: row.steps_unknown,
    sessionOutcome: row.session_outcome,
    finalTxHash: row.final_tx_hash,
    finalReceiptStatus: row.final_receipt_status,
    finalEngineValid: row.final_engine_valid,
    finalExecResult: row.final_exec_result,
    orchestration: row.orchestration_any,
    execContract: row.exec_contract_any,
    ruleContract: row.rule_contract_any,
    feesTotal: row.fees_total,
    txGasTotal: row.tx_gas_total,
    innerGasTotal: row.inner_gas_total
  };
}

function mergePayload(session: XdalaSessionSummary, payload: PayloadRow | undefined): XdalaSessionWithPayload {
  if (!payload) return session;

  return {
    ...session,
    payload: parseJsonb(payload.engine_payload),
    apiSaves: parseJsonb(payload.engine_api_saves),
    contractSaves: parseJsonb(payload.engine_contract_saves),
    extras: parseJsonb(payload.engine_extras),
    finalStepId: payload.engine_step_id,
    finalIteration: payload.engine_iteration,
    ostcId: payload.engine_ostc_id,
    ostcHash: payload.engine_ostc_hash,
    finalRuleContract: payload.engine_rule_contract,
    finalExecContract: payload.engine_exec_contract,
    finalReceiptEngineValid: payload.engine_valid,
    receiptUpdatedAt: toIsoString(payload.updated_at),
    finalBlockNumber: payload.block_number
  };
}

type XdalaAnalyticsBucket = 'hour' | 'day' | 'month';
type XdalaStepStatsBucket = XdalaAnalyticsBucket | 'none';

const TIMESERIES_LIMIT = 1000;
const ZERO = '0';

export interface XdalaAnalyticsWindowInput {
  owner?: string;
  windowHours?: number;
}

export type XdalaSessionStatsInput = XdalaAnalyticsWindowInput;

export interface XdalaSessionTimeseriesInput extends XdalaAnalyticsWindowInput {
  bucket?: XdalaAnalyticsBucket;
}

export interface XdalaStepStatsInput extends XdalaAnalyticsWindowInput {
  sessionId?: string;
  bucket?: XdalaStepStatsBucket;
}

export interface XdalaActiveSessionsTimeseriesInput {
  windowHours?: number;
}

export interface XdalaTopError {
  errorClass: string | null;
  errorMsg: string | null;
  count: string;
}

export interface XdalaSessionStats {
  windowHours: number;
  owner?: string;
  sessionsTotal: string;
  sessionsSuccess: string;
  sessionsFail: string;
  sessionsUnknown: string;
  uniqueOwners: string;
  avgStepsPerSession: string;
  avgDurationS: string;
  p95DurationS: string;
  totalSteps: string;
  totalTxGas: string;
  totalInnerGas: string;
  totalFees: string;
  validatorImmediateFeesTotal: string;
  validatorPooledFeesTotal: string;
  topErrors: XdalaTopError[];
}

export interface XdalaSessionTimeseriesRow {
  bucket: string | null;
  sessionsStarted: string;
  sessionsSuccess: string;
  sessionsFail: string;
  sessionsUnknown: string;
  avgStepsPerSession: string;
  avgDurationS: string;
  p95DurationS: string;
  totalSteps: string;
  totalTxGas: string;
  totalFees: string;
}

export interface XdalaStepStatsSummary {
  windowHours: number;
  owner?: string;
  sessionId?: string;
  stepsTotal: string;
  stepsValid: string;
  stepsInvalid: string;
  stepsFail: string;
  totalInnerGas: string;
  totalTxGas: string;
  totalFees: string;
}

export interface XdalaStepStatsTimeseriesRow {
  bucket: string | null;
  stepsTotal: string;
  stepsValid: string;
  stepsInvalid: string;
  stepsFail: string;
  innerGasTotal: string;
  txGasTotal: string;
  feesTotal: string;
}

export interface XdalaActiveSessionsTimeseriesRow {
  bucket: string | null;
  activeSessions: string;
}

interface SessionStatsRow {
  sessions_total: string | null;
  sessions_success: string | null;
  sessions_fail: string | null;
  sessions_unknown: string | null;
  unique_owners: string | null;
  avg_steps_per_session: string | null;
  avg_duration_s: string | null;
  p95_duration_s: string | null;
  total_steps: string | null;
  total_tx_gas: string | null;
  total_inner_gas: string | null;
  total_fees: string | null;
  validator_immediate_fees_total: string | null;
  validator_pooled_fees_total: string | null;
}

interface TopErrorRow {
  error_class: string | null;
  error_msg: string | null;
  count: string | null;
}

interface SessionTimeseriesRow {
  bucket: Date | string | null;
  sessions_started: string | null;
  sessions_success: string | null;
  sessions_fail: string | null;
  sessions_unknown: string | null;
  avg_steps_per_session: string | null;
  avg_duration_s: string | null;
  p95_duration_s: string | null;
  total_steps: string | null;
  total_tx_gas: string | null;
  total_fees: string | null;
}

interface StepStatsRow {
  steps_total: string | null;
  steps_valid: string | null;
  steps_invalid: string | null;
  steps_fail: string | null;
  total_inner_gas: string | null;
  total_tx_gas: string | null;
  total_fees: string | null;
}

interface StepTimeseriesRow {
  bucket: Date | string | null;
  steps_total: string | null;
  steps_valid: string | null;
  steps_invalid: string | null;
  steps_fail: string | null;
  inner_gas_total: string | null;
  tx_gas_total: string | null;
  fees_total: string | null;
}

interface ActiveSessionsTimeseriesRow {
  bucket: Date | string | null;
  active_sessions: string | null;
}

function normalizeBucket(bucket: XdalaAnalyticsBucket | undefined): XdalaAnalyticsBucket {
  if (bucket === 'hour' || bucket === 'month') return bucket;
  return 'day';
}

function normalizeStepStatsBucket(bucket: XdalaStepStatsBucket | undefined): XdalaStepStatsBucket {
  if (bucket === 'hour' || bucket === 'day' || bucket === 'month') return bucket;
  return 'none';
}

function sessionTimeseriesView(bucket: XdalaAnalyticsBucket): string {
  return `mv_sessions_started_${bucket}`;
}

function stepTimeseriesView(bucket: XdalaAnalyticsBucket): string {
  return `mv_steps_${bucket}`;
}

function valueOrZero(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ZERO;
  return String(value);
}

function buildWindowWhere(column: string, windowHours: number, params: unknown[]): string[] {
  if (windowHours <= 0) return [];
  params.push(windowHours);
  return [`${column} >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`];
}

function buildBucketWindowWhere(column: string, bucket: XdalaAnalyticsBucket, windowHours: number, params: unknown[]): string[] {
  if (windowHours <= 0) return [];
  params.push(windowHours);
  return [`${column} >= date_trunc('${bucket}', NOW() - ($${params.length}::int * INTERVAL '1 hour'))`];
}

function mapSessionTimeseriesRow(row: SessionTimeseriesRow): XdalaSessionTimeseriesRow {
  return {
    bucket: toIsoString(row.bucket),
    sessionsStarted: valueOrZero(row.sessions_started),
    sessionsSuccess: valueOrZero(row.sessions_success),
    sessionsFail: valueOrZero(row.sessions_fail),
    sessionsUnknown: valueOrZero(row.sessions_unknown),
    avgStepsPerSession: valueOrZero(row.avg_steps_per_session),
    avgDurationS: valueOrZero(row.avg_duration_s),
    p95DurationS: valueOrZero(row.p95_duration_s),
    totalSteps: valueOrZero(row.total_steps),
    totalTxGas: valueOrZero(row.total_tx_gas),
    totalFees: valueOrZero(row.total_fees)
  };
}

function mapStepTimeseriesRow(row: StepTimeseriesRow): XdalaStepStatsTimeseriesRow {
  return {
    bucket: toIsoString(row.bucket),
    stepsTotal: valueOrZero(row.steps_total),
    stepsValid: valueOrZero(row.steps_valid),
    stepsInvalid: valueOrZero(row.steps_invalid),
    stepsFail: valueOrZero(row.steps_fail),
    innerGasTotal: valueOrZero(row.inner_gas_total),
    txGasTotal: valueOrZero(row.tx_gas_total),
    feesTotal: valueOrZero(row.fees_total)
  };
}

function mapActiveSessionsTimeseriesRow(row: ActiveSessionsTimeseriesRow): XdalaActiveSessionsTimeseriesRow {
  return {
    bucket: toIsoString(row.bucket),
    activeSessions: valueOrZero(row.active_sessions)
  };
}

export async function findRecentXdalaSessions(
  input: FindRecentXdalaSessionsInput = {}
): Promise<Array<XdalaSessionSummary | XdalaSessionWithPayload>> {
  const limit = normalizeLimit(input.limit);
  const windowHours = normalizeWindowHours(input.windowHours);
  const params: unknown[] = [];
  const where: string[] = [];

  if (windowHours > 0) {
    params.push(windowHours);
    where.push(`last_seen_at >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`);
  }

  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`owner = $${params.length}`);
  }

  params.push(limit);
  const sql = `
    SELECT
      owner,
      session_id,
      started_at,
      last_seen_at,
      duration_s,
      steps_total,
      steps_ok,
      steps_fail,
      steps_unknown,
      session_outcome,
      final_tx_hash,
      final_receipt_status,
      final_engine_valid,
      final_exec_result,
      orchestration_any,
      exec_contract_any,
      rule_contract_any,
      fees_total,
      tx_gas_total,
      inner_gas_total
    FROM mv_sessions
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY last_seen_at DESC NULLS LAST, final_tx_hash DESC
    LIMIT $${params.length}
  `;

  const result = await explorerDbQuery<SessionRow>(sql, params);
  const sessions = result.rows.map(mapSessionRow);

  if (!input.includePayload || sessions.length === 0) {
    return sessions;
  }

  const hashes = sessions.map((session) => session.finalTxHash).filter((hash): hash is string => Boolean(hash));
  if (hashes.length === 0) {
    return sessions;
  }

  const payloadResult = await explorerDbQuery<PayloadRow>(
    `
      SELECT
        tx_hash,
        engine_payload,
        engine_api_saves,
        engine_contract_saves,
        engine_extras,
        engine_step_id,
        engine_iteration,
        engine_ostc_id,
        engine_ostc_hash,
        engine_rule_contract,
        engine_exec_contract,
        engine_valid,
        updated_at,
        block_number
      FROM tx_receipts
      WHERE tx_hash = ANY($1::text[])
    `,
    [hashes]
  );

  const payloadByHash = new Map(payloadResult.rows.map((row) => [row.tx_hash, row]));
  return sessions.map((session) => mergePayload(session, session.finalTxHash ? payloadByHash.get(session.finalTxHash) : undefined));
}

export async function getLatestXdalaSessionPayload(
  input: Omit<FindRecentXdalaSessionsInput, 'limit' | 'includePayload'> = {}
): Promise<XdalaSessionWithPayload | null> {
  const sessions = await findRecentXdalaSessions({ ...input, limit: 1, includePayload: true });
  return (sessions[0] as XdalaSessionWithPayload | undefined) ?? null;
}



export type XdalaSessionOutcomeFilter = 'any' | 'success' | 'fail' | 'unknown';



export type XdalaPayloadSource = 'payload' | 'apiSaves' | 'contractSaves' | 'extras';
export type XdalaPayloadTermMode = 'keys' | 'values' | 'keys_and_values';

export interface XdalaPayloadAnalyticsInput {
  owner?: string;
  windowHours?: number;
  outcome?: XdalaSessionOutcomeFilter;
  source?: XdalaPayloadSource;
  limit?: number;
}

export interface XdalaPayloadKeyStat {
  key: string;
  occurrences: string;
  sessionsWithKey: string;
  emptyCount: string;
  nonEmptyCount: string;
}

export interface XdalaPayloadTermStatsInput extends XdalaPayloadAnalyticsInput {
  mode?: XdalaPayloadTermMode;
  minTermLength?: number;
}

export interface XdalaPayloadTermStat {
  term: string;
  occurrences: string;
  sessionsWithTerm: string;
  sourceKinds: string;
}

export interface XdalaPayloadFieldValueStatsInput extends XdalaPayloadAnalyticsInput {
  field: string;
}

export interface XdalaPayloadFieldValueStat {
  field: string;
  value: string | null;
  occurrences: string;
  sessionsWithValue: string;
}

interface PayloadKeyStatsRow {
  key: string;
  occurrences: string | null;
  sessions_with_key: string | null;
  empty_count: string | null;
  non_empty_count: string | null;
}

interface PayloadTermStatsRow {
  term: string;
  occurrences: string | null;
  sessions_with_term: string | null;
  source_kinds: string | null;
}

interface PayloadFieldValueStatsRow {
  field: string;
  value: string | null;
  occurrences: string | null;
  sessions_with_value: string | null;
}

export interface ListXdalaSessionOwnersInput {
  windowHours?: number;
  limit?: number;
}

export interface XdalaSessionOwnerDiscovery {
  owner: string | null;
  sessionsTotal: string;
  sessionsSuccess: string;
  sessionsFail: string;
  sessionsUnknown: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latestSessionId: string | null;
  latestFinalTxHash: string | null;
}

export interface ListXdalaSessionsInput {
  owner?: string;
  windowHours?: number;
  outcome?: XdalaSessionOutcomeFilter;
  limit?: number;
  cursor?: {
    lastSeenAt: string;
    owner: string;
    sessionId: string;
  };
}

export interface ListXdalaSessionsResult {
  items: XdalaSessionSummary[];
  nextCursor: null | {
    lastSeenAt: string;
    owner: string;
    sessionId: string;
  };
}

export interface ListXdalaSessionIdsInput {
  owner?: string;
  windowHours?: number;
  outcome?: XdalaSessionOutcomeFilter;
  limitOwners?: number;
  maxSessionIdsPerOwner?: number;
}

export interface XdalaSessionIdsByOwner {
  owner: string | null;
  sessionsTotal: string;
  returnedSessionIds: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sessionIds: string[];
}

export interface GetXdalaSessionDetailInput {
  owner: string;
  sessionId: string;
  includePayloads?: boolean;
  includeFinalPayload?: boolean;
  limitSteps?: number;
}

interface SessionOwnerDiscoveryRow {
  owner: string | null;
  sessions_total: string | null;
  sessions_success: string | null;
  sessions_fail: string | null;
  sessions_unknown: string | null;
  first_seen_at: Date | string | null;
  last_seen_at: Date | string | null;
  latest_session_id: string | null;
  latest_final_tx_hash: string | null;
}

interface SessionIdsByOwnerRow {
  owner: string | null;
  sessions_total: string | null;
  returned_session_ids: string | null;
  first_seen_at: Date | string | null;
  last_seen_at: Date | string | null;
  session_ids: string[] | null;
}

interface SessionDetailSummaryRow extends SessionRow {
  error_class_any: string | null;
  error_msg_any: string | null;
}

interface SessionStepRow {
  tx_hash: string | null;
  block_number: string | number | null;
  ts: Date | string | null;
  iteration: string | number | null;
  step_id: string | null;
  orchestration: string | null;
  exec_contract: string | null;
  rule_contract: string | null;
  exec_result: boolean | null;
  engine_valid: boolean | null;
  receipt_status: number | null;
  error_class: string | null;
  error_msg: string | null;
  tx_gas_used: string | null;
  inner_gas_used: string | null;
  donation_fee: string | null;
  validator_fee: string | null;
  validator_immediate_fee: string | null;
  validator_pooled_fee: string | null;
  burned_fee: string | null;
  fee_logic: string | null;
}

interface ReceiptPayloadOnlyRow {
  tx_hash: string;
  engine_payload: unknown;
  engine_api_saves: unknown;
  engine_contract_saves: unknown;
  engine_extras: unknown;
}

export interface XdalaSessionDetailSummary extends XdalaSessionSummary {
  errorClass: string | null;
  errorMsg: string | null;
}

export interface XdalaSessionStep {
  txHash: string | null;
  blockNumber: string | number | null;
  ts: string | null;
  iteration: string | number | null;
  stepId: string | null;
  orchestration: string | null;
  execContract: string | null;
  ruleContract: string | null;
  execResult: boolean | null;
  engineValid: boolean | null;
  receiptStatus: number | null;
  errorClass: string | null;
  errorMsg: string | null;
  txGasUsed: string | null;
  innerGasUsed: string | null;
  donationFee: string | null;
  validatorFee: string | null;
  validatorImmediateFee: string | null;
  validatorPooledFee: string | null;
  burnedFee: string | null;
  feeLogic: string | null;
  payload?: unknown;
  apiSaves?: unknown;
  contractSaves?: unknown;
  extras?: unknown;
}

export interface XdalaSessionDetail {
  summary: XdalaSessionDetailSummary | null;
  steps: XdalaSessionStep[];
  finalPayload?: unknown;
  finalApiSaves?: unknown;
  finalContractSaves?: unknown;
  finalExtras?: unknown;
}

function normalizeCappedLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (!Number.isFinite(limit)) return defaultLimit;
  return Math.min(Math.max(Math.trunc(limit ?? defaultLimit), 1), maxLimit);
}

function normalizeOutcome(outcome: XdalaSessionOutcomeFilter | undefined): XdalaSessionOutcomeFilter {
  if (outcome === 'success' || outcome === 'fail' || outcome === 'unknown') return outcome;
  return 'any';
}

function addSessionDiscoveryFilters(
  where: string[],
  params: unknown[],
  input: { owner?: string; windowHours?: number; outcome?: XdalaSessionOutcomeFilter }
): void {
  const windowHours = normalizeWindowHours(input.windowHours);
  if (windowHours > 0) {
    params.push(windowHours);
    where.push(`last_seen_at >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`);
  }

  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`owner = $${params.length}`);
  }

  const outcome = normalizeOutcome(input.outcome);
  if (outcome !== 'any') {
    params.push(outcome);
    where.push(`session_outcome = $${params.length}`);
  }
}

function mapOwnerDiscoveryRow(row: SessionOwnerDiscoveryRow): XdalaSessionOwnerDiscovery {
  return {
    owner: row.owner,
    sessionsTotal: valueOrZero(row.sessions_total),
    sessionsSuccess: valueOrZero(row.sessions_success),
    sessionsFail: valueOrZero(row.sessions_fail),
    sessionsUnknown: valueOrZero(row.sessions_unknown),
    firstSeenAt: toIsoString(row.first_seen_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    latestSessionId: row.latest_session_id,
    latestFinalTxHash: row.latest_final_tx_hash
  };
}

function mapSessionIdsByOwnerRow(row: SessionIdsByOwnerRow): XdalaSessionIdsByOwner {
  return {
    owner: row.owner,
    sessionsTotal: valueOrZero(row.sessions_total),
    returnedSessionIds: valueOrZero(row.returned_session_ids),
    firstSeenAt: toIsoString(row.first_seen_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    sessionIds: row.session_ids ?? []
  };
}

function mapDetailSummaryRow(row: SessionDetailSummaryRow): XdalaSessionDetailSummary {
  return {
    ...mapSessionRow(row),
    errorClass: row.error_class_any,
    errorMsg: row.error_msg_any
  };
}

function mapStepRow(row: SessionStepRow): XdalaSessionStep {
  return {
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    ts: toIsoString(row.ts),
    iteration: row.iteration,
    stepId: row.step_id,
    orchestration: row.orchestration,
    execContract: row.exec_contract,
    ruleContract: row.rule_contract,
    execResult: row.exec_result,
    engineValid: row.engine_valid,
    receiptStatus: row.receipt_status,
    errorClass: row.error_class,
    errorMsg: row.error_msg,
    txGasUsed: row.tx_gas_used,
    innerGasUsed: row.inner_gas_used,
    donationFee: row.donation_fee,
    validatorFee: row.validator_fee,
    validatorImmediateFee: row.validator_immediate_fee,
    validatorPooledFee: row.validator_pooled_fee,
    burnedFee: row.burned_fee,
    feeLogic: row.fee_logic
  };
}

function payloadOnlyToFields(payload: ReceiptPayloadOnlyRow | undefined): Pick<XdalaSessionStep, 'payload' | 'apiSaves' | 'contractSaves' | 'extras'> {
  if (!payload) return {};
  return {
    payload: parseJsonb(payload.engine_payload),
    apiSaves: parseJsonb(payload.engine_api_saves),
    contractSaves: parseJsonb(payload.engine_contract_saves),
    extras: parseJsonb(payload.engine_extras)
  };
}

export async function listXdalaSessionOwners(input: ListXdalaSessionOwnersInput = {}): Promise<XdalaSessionOwnerDiscovery[]> {
  const limit = normalizeCappedLimit(input.limit, 100, 500);
  const params: unknown[] = [];
  const where: string[] = [];
  addSessionDiscoveryFilters(where, params, { windowHours: input.windowHours });

  params.push(limit);
  const result = await explorerDbQuery<SessionOwnerDiscoveryRow>(
    `
      WITH base AS (
        SELECT
          owner,
          session_id,
          started_at,
          last_seen_at,
          final_tx_hash,
          session_outcome
        FROM mv_sessions
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ),
      owner_agg AS (
        SELECT
          owner,
          COUNT(*)::bigint AS sessions_total,
          COUNT(*) FILTER (WHERE session_outcome = 'success')::bigint AS sessions_success,
          COUNT(*) FILTER (WHERE session_outcome = 'fail')::bigint AS sessions_fail,
          COUNT(*) FILTER (WHERE session_outcome = 'unknown')::bigint AS sessions_unknown,
          MIN(started_at) AS first_seen_at,
          MAX(last_seen_at) AS last_seen_at
        FROM base
        GROUP BY owner
      ),
      latest AS (
        SELECT DISTINCT ON (owner)
          owner,
          session_id AS latest_session_id,
          final_tx_hash AS latest_final_tx_hash
        FROM base
        ORDER BY owner, last_seen_at DESC NULLS LAST, session_id ASC
      )
      SELECT
        owner_agg.owner,
        owner_agg.sessions_total,
        owner_agg.sessions_success,
        owner_agg.sessions_fail,
        owner_agg.sessions_unknown,
        owner_agg.first_seen_at,
        owner_agg.last_seen_at,
        latest.latest_session_id,
        latest.latest_final_tx_hash
      FROM owner_agg
      JOIN latest ON latest.owner = owner_agg.owner
      ORDER BY owner_agg.last_seen_at DESC NULLS LAST, owner_agg.owner ASC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows.map(mapOwnerDiscoveryRow);
}

export async function listXdalaSessions(input: ListXdalaSessionsInput = {}): Promise<ListXdalaSessionsResult> {
  const limit = normalizeCappedLimit(input.limit, 50, 100);
  const params: unknown[] = [];
  const where: string[] = [];
  addSessionDiscoveryFilters(where, params, input);

  if (input.cursor) {
    params.push(input.cursor.lastSeenAt, input.cursor.owner.toLowerCase(), input.cursor.sessionId);
    const lastSeenAtParam = params.length - 2;
    const ownerParam = params.length - 1;
    const sessionIdParam = params.length;
    where.push(`(
      last_seen_at < $${lastSeenAtParam}::timestamptz
      OR (last_seen_at = $${lastSeenAtParam}::timestamptz AND owner > $${ownerParam})
      OR (last_seen_at = $${lastSeenAtParam}::timestamptz AND owner = $${ownerParam} AND session_id > $${sessionIdParam})
    )`);
  }

  params.push(limit + 1);
  const result = await explorerDbQuery<SessionRow>(
    `
      SELECT
        owner,
        session_id,
        started_at,
        last_seen_at,
        duration_s,
        steps_total,
        steps_ok,
        steps_fail,
        steps_unknown,
        session_outcome,
        final_tx_hash,
        final_receipt_status,
        final_engine_valid,
        final_exec_result,
        orchestration_any,
        exec_contract_any,
        rule_contract_any,
        fees_total,
        tx_gas_total,
        inner_gas_total
      FROM mv_sessions
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY last_seen_at DESC NULLS LAST, owner ASC, session_id ASC
      LIMIT $${params.length}
    `,
    params
  );

  const rows = result.rows.slice(0, limit);
  const items = rows.map(mapSessionRow);
  const last = items.at(-1);
  const nextCursor = result.rows.length > limit && last?.lastSeenAt && last.owner && last.sessionId
    ? { lastSeenAt: last.lastSeenAt, owner: last.owner, sessionId: last.sessionId }
    : null;

  return { items, nextCursor };
}

export async function listXdalaSessionIds(input: ListXdalaSessionIdsInput = {}): Promise<XdalaSessionIdsByOwner[]> {
  const limitOwners = normalizeCappedLimit(input.limitOwners, 100, 500);
  const maxSessionIdsPerOwner = normalizeCappedLimit(input.maxSessionIdsPerOwner, 500, 2000);
  const params: unknown[] = [];
  const where: string[] = [];
  addSessionDiscoveryFilters(where, params, input);

  params.push(maxSessionIdsPerOwner, limitOwners);
  const maxSessionIdsParam = params.length - 1;
  const limitOwnersParam = params.length;
  const result = await explorerDbQuery<SessionIdsByOwnerRow>(
    `
      WITH base AS (
        SELECT
          owner,
          session_id,
          started_at,
          last_seen_at,
          ROW_NUMBER() OVER (PARTITION BY owner ORDER BY last_seen_at DESC NULLS LAST, session_id ASC) AS session_rank
        FROM mv_sessions
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ),
      owner_agg AS (
        SELECT
          owner,
          COUNT(*)::bigint AS sessions_total,
          MIN(started_at) AS first_seen_at,
          MAX(last_seen_at) AS last_seen_at
        FROM base
        GROUP BY owner
      ),
      capped_sessions AS (
        SELECT owner, session_id, last_seen_at
        FROM base
        WHERE session_rank <= $${maxSessionIdsParam}
      )
      SELECT
        owner_agg.owner,
        owner_agg.sessions_total,
        COUNT(capped_sessions.session_id)::bigint AS returned_session_ids,
        owner_agg.first_seen_at,
        owner_agg.last_seen_at,
        COALESCE(
          ARRAY_AGG(capped_sessions.session_id ORDER BY capped_sessions.last_seen_at DESC NULLS LAST, capped_sessions.session_id ASC)
            FILTER (WHERE capped_sessions.session_id IS NOT NULL),
          ARRAY[]::text[]
        ) AS session_ids
      FROM owner_agg
      LEFT JOIN capped_sessions ON capped_sessions.owner = owner_agg.owner
      GROUP BY owner_agg.owner, owner_agg.sessions_total, owner_agg.first_seen_at, owner_agg.last_seen_at
      ORDER BY owner_agg.last_seen_at DESC NULLS LAST, owner_agg.owner ASC
      LIMIT $${limitOwnersParam}
    `,
    params
  );

  return result.rows.map(mapSessionIdsByOwnerRow);
}

export async function getXdalaSessionDetail(input: GetXdalaSessionDetailInput): Promise<XdalaSessionDetail | null> {
  const owner = input.owner.toLowerCase();
  const limitSteps = normalizeCappedLimit(input.limitSteps, 500, 1000);
  const summaryResult = await explorerDbQuery<SessionDetailSummaryRow>(
    `
      SELECT
        owner,
        session_id,
        started_at,
        last_seen_at,
        duration_s,
        steps_total,
        steps_ok,
        steps_fail,
        steps_unknown,
        session_outcome,
        error_class_any,
        error_msg_any,
        final_tx_hash,
        final_receipt_status,
        final_engine_valid,
        final_exec_result,
        orchestration_any,
        exec_contract_any,
        rule_contract_any,
        fees_total,
        tx_gas_total,
        inner_gas_total
      FROM mv_sessions
      WHERE owner = $1 AND session_id = $2
      LIMIT 1
    `,
    [owner, input.sessionId]
  );

  const summary = summaryResult.rows[0] ? mapDetailSummaryRow(summaryResult.rows[0]) : null;
  if (!summary) return null;

  const stepsResult = await explorerDbQuery<SessionStepRow>(
    `
      SELECT
        tx_hash,
        block_number,
        ts,
        iteration,
        step_id,
        orchestration,
        exec_contract,
        rule_contract,
        exec_result,
        engine_valid,
        receipt_status,
        error_class,
        error_msg,
        tx_gas_used,
        inner_gas_used,
        donation_fee,
        validator_fee,
        validator_immediate_fee,
        validator_pooled_fee,
        burned_fee,
        fee_logic
      FROM mv_session_steps
      WHERE owner = $1 AND session_id = $2
      ORDER BY ts ASC, iteration ASC, tx_hash ASC
      LIMIT $3
    `,
    [owner, input.sessionId, limitSteps]
  );

  let steps = stepsResult.rows.map(mapStepRow);
  if (input.includePayloads) {
    const hashes = steps.map((step) => step.txHash).filter((hash): hash is string => Boolean(hash));
    if (hashes.length > 0) {
      const payloadResult = await explorerDbQuery<ReceiptPayloadOnlyRow>(
        `
          SELECT
            tx_hash,
            engine_payload,
            engine_api_saves,
            engine_contract_saves,
            engine_extras
          FROM tx_receipts
          WHERE tx_hash = ANY($1::text[])
        `,
        [hashes]
      );
      const payloadByHash = new Map(payloadResult.rows.map((row) => [row.tx_hash, row]));
      steps = steps.map((step) => ({
        ...step,
        ...payloadOnlyToFields(step.txHash ? payloadByHash.get(step.txHash) : undefined)
      }));
    }
  }

  const detail: XdalaSessionDetail = { summary, steps };
  if (input.includeFinalPayload && summary.finalTxHash) {
    const finalPayloadResult = await explorerDbQuery<ReceiptPayloadOnlyRow>(
      `
        SELECT
          tx_hash,
          engine_payload,
          engine_api_saves,
          engine_contract_saves,
          engine_extras
        FROM tx_receipts
        WHERE tx_hash = $1
        LIMIT 1
      `,
      [summary.finalTxHash]
    );
    const finalPayload = finalPayloadResult.rows[0];
    if (finalPayload) {
      detail.finalPayload = parseJsonb(finalPayload.engine_payload);
      detail.finalApiSaves = parseJsonb(finalPayload.engine_api_saves);
      detail.finalContractSaves = parseJsonb(finalPayload.engine_contract_saves);
      detail.finalExtras = parseJsonb(finalPayload.engine_extras);
    }
  }

  return detail;
}

export async function getXdalaSessionStats(input: XdalaSessionStatsInput = {}): Promise<XdalaSessionStats> {
  const windowHours = normalizeWindowHours(input.windowHours);
  const params: unknown[] = [];
  const where = buildWindowWhere('started_at', windowHours, params);

  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`owner = $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const summaryResult = await explorerDbQuery<SessionStatsRow>(
    `
      SELECT
        COUNT(*)::bigint AS sessions_total,
        COUNT(*) FILTER (WHERE session_outcome = 'success')::bigint AS sessions_success,
        COUNT(*) FILTER (WHERE session_outcome = 'fail')::bigint AS sessions_fail,
        COUNT(*) FILTER (WHERE session_outcome = 'unknown')::bigint AS sessions_unknown,
        COUNT(DISTINCT owner)::bigint AS unique_owners,
        COALESCE(AVG(steps_total), 0)::numeric(20,4) AS avg_steps_per_session,
        COALESCE(AVG(duration_s), 0)::numeric(20,4) AS avg_duration_s,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_s), 0)::numeric(20,4) AS p95_duration_s,
        COALESCE(SUM(steps_total), 0)::numeric(78,0) AS total_steps,
        COALESCE(SUM(tx_gas_total), 0)::numeric(78,0) AS total_tx_gas,
        COALESCE(SUM(inner_gas_total), 0)::numeric(78,0) AS total_inner_gas,
        COALESCE(SUM(fees_total), 0)::numeric(78,0) AS total_fees,
        COALESCE(SUM(validator_immediate_fees_total), 0)::numeric(78,0) AS validator_immediate_fees_total,
        COALESCE(SUM(validator_pooled_fees_total), 0)::numeric(78,0) AS validator_pooled_fees_total
      FROM mv_sessions
      ${whereSql}
    `,
    params
  );

  const topErrorsResult = await explorerDbQuery<TopErrorRow>(
    `
      SELECT
        error_class_any AS error_class,
        error_msg_any AS error_msg,
        COUNT(*)::bigint AS count
      FROM mv_sessions
      ${where.length > 0 ? `${whereSql} AND` : 'WHERE'} (error_class_any IS NOT NULL OR error_msg_any IS NOT NULL)
      GROUP BY error_class_any, error_msg_any
      ORDER BY count DESC
      LIMIT 10
    `,
    params
  );

  const row = summaryResult.rows[0];
  return {
    windowHours,
    ...(input.owner ? { owner: input.owner.toLowerCase() } : {}),
    sessionsTotal: valueOrZero(row?.sessions_total),
    sessionsSuccess: valueOrZero(row?.sessions_success),
    sessionsFail: valueOrZero(row?.sessions_fail),
    sessionsUnknown: valueOrZero(row?.sessions_unknown),
    uniqueOwners: valueOrZero(row?.unique_owners),
    avgStepsPerSession: valueOrZero(row?.avg_steps_per_session),
    avgDurationS: valueOrZero(row?.avg_duration_s),
    p95DurationS: valueOrZero(row?.p95_duration_s),
    totalSteps: valueOrZero(row?.total_steps),
    totalTxGas: valueOrZero(row?.total_tx_gas),
    totalInnerGas: valueOrZero(row?.total_inner_gas),
    totalFees: valueOrZero(row?.total_fees),
    validatorImmediateFeesTotal: valueOrZero(row?.validator_immediate_fees_total),
    validatorPooledFeesTotal: valueOrZero(row?.validator_pooled_fees_total),
    topErrors: topErrorsResult.rows.map((error) => ({
      errorClass: error.error_class,
      errorMsg: error.error_msg,
      count: valueOrZero(error.count)
    }))
  };
}

export async function getXdalaSessionTimeseries(
  input: XdalaSessionTimeseriesInput = {}
): Promise<XdalaSessionTimeseriesRow[]> {
  const windowHours = normalizeWindowHours(input.windowHours);
  const bucket = normalizeBucket(input.bucket);
  const params: unknown[] = [];
  const where = input.owner
    ? buildWindowWhere('started_at', windowHours, params)
    : buildBucketWindowWhere('bucket', bucket, windowHours, params);

  if (!input.owner) {
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const result = await explorerDbQuery<SessionTimeseriesRow>(
      `
        SELECT
          bucket,
          sessions_started,
          sessions_success,
          sessions_fail,
          sessions_unknown,
          avg_steps_per_session,
          avg_duration_s,
          p95_duration_s,
          total_steps,
          total_tx_gas,
          total_fees
        FROM ${sessionTimeseriesView(bucket)}
        ${whereSql}
        ORDER BY bucket ASC
        LIMIT ${TIMESERIES_LIMIT}
      `,
      params
    );
    return result.rows.map(mapSessionTimeseriesRow);
  }

  params.push(input.owner.toLowerCase());
  where.push(`owner = $${params.length}`);
  const result = await explorerDbQuery<SessionTimeseriesRow>(
    `
      SELECT
        date_trunc($${params.length + 1}, started_at) AS bucket,
        COUNT(*)::bigint AS sessions_started,
        COUNT(*) FILTER (WHERE session_outcome = 'success')::bigint AS sessions_success,
        COUNT(*) FILTER (WHERE session_outcome = 'fail')::bigint AS sessions_fail,
        COUNT(*) FILTER (WHERE session_outcome = 'unknown')::bigint AS sessions_unknown,
        COALESCE(AVG(steps_total), 0)::numeric(20,4) AS avg_steps_per_session,
        COALESCE(AVG(duration_s), 0)::numeric(20,4) AS avg_duration_s,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_s), 0)::numeric(20,4) AS p95_duration_s,
        COALESCE(SUM(steps_total), 0)::numeric(78,0) AS total_steps,
        COALESCE(SUM(tx_gas_total), 0)::numeric(78,0) AS total_tx_gas,
        COALESCE(SUM(fees_total), 0)::numeric(78,0) AS total_fees
      FROM mv_sessions
      WHERE ${where.join(' AND ')}
      GROUP BY 1
      ORDER BY bucket ASC
      LIMIT ${TIMESERIES_LIMIT}
    `,
    [...params, bucket]
  );
  return result.rows.map(mapSessionTimeseriesRow);
}

export async function getXdalaStepStats(
  input: XdalaStepStatsInput = {}
): Promise<XdalaStepStatsSummary | XdalaStepStatsTimeseriesRow[]> {
  const windowHours = normalizeWindowHours(input.windowHours);
  const bucket = normalizeStepStatsBucket(input.bucket);
  const params: unknown[] = [];
  const where = bucket === 'none' || input.owner || input.sessionId
    ? buildWindowWhere('ts', windowHours, params)
    : buildBucketWindowWhere('bucket', bucket, windowHours, params);

  if (input.owner) {
    params.push(input.owner.toLowerCase());
    where.push(`owner = $${params.length}`);
  }

  if (input.sessionId) {
    params.push(input.sessionId);
    where.push(`session_id = $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  if (bucket === 'none') {
    const result = await explorerDbQuery<StepStatsRow>(
      `
        SELECT
          COUNT(*)::bigint AS steps_total,
          COUNT(*) FILTER (WHERE error_class IS NULL AND error_msg IS NULL AND engine_valid IS TRUE)::bigint AS steps_valid,
          COUNT(*) FILTER (WHERE error_class IS NULL AND error_msg IS NULL AND engine_valid IS DISTINCT FROM TRUE)::bigint AS steps_invalid,
          COUNT(*) FILTER (WHERE error_class IS NOT NULL OR error_msg IS NOT NULL)::bigint AS steps_fail,
          COALESCE(SUM(inner_gas_used), 0)::numeric(78,0) AS total_inner_gas,
          COALESCE(SUM(tx_gas_used), 0)::numeric(78,0) AS total_tx_gas,
          COALESCE(SUM(COALESCE(donation_fee, 0) + COALESCE(validator_fee, 0) + COALESCE(burned_fee, 0)), 0)::numeric(78,0) AS total_fees
        FROM mv_session_steps
        ${whereSql}
      `,
      params
    );
    const row = result.rows[0];
    return {
      windowHours,
      ...(input.owner ? { owner: input.owner.toLowerCase() } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      stepsTotal: valueOrZero(row?.steps_total),
      stepsValid: valueOrZero(row?.steps_valid),
      stepsInvalid: valueOrZero(row?.steps_invalid),
      stepsFail: valueOrZero(row?.steps_fail),
      totalInnerGas: valueOrZero(row?.total_inner_gas),
      totalTxGas: valueOrZero(row?.total_tx_gas),
      totalFees: valueOrZero(row?.total_fees)
    };
  }

  if (!input.owner && !input.sessionId) {
    const result = await explorerDbQuery<StepTimeseriesRow>(
      `
        SELECT
          bucket,
          steps_total,
          steps_valid,
          steps_invalid,
          steps_fail,
          inner_gas_total,
          tx_gas_total,
          fees_total
        FROM ${stepTimeseriesView(bucket)}
        ${whereSql}
        ORDER BY bucket ASC
        LIMIT ${TIMESERIES_LIMIT}
      `,
      params
    );
    return result.rows.map(mapStepTimeseriesRow);
  }

  const result = await explorerDbQuery<StepTimeseriesRow>(
    `
      SELECT
        date_trunc($${params.length + 1}, ts) AS bucket,
        COUNT(*)::bigint AS steps_total,
        COUNT(*) FILTER (WHERE error_class IS NULL AND error_msg IS NULL AND engine_valid IS TRUE)::bigint AS steps_valid,
        COUNT(*) FILTER (WHERE error_class IS NULL AND error_msg IS NULL AND engine_valid IS DISTINCT FROM TRUE)::bigint AS steps_invalid,
        COUNT(*) FILTER (WHERE error_class IS NOT NULL OR error_msg IS NOT NULL)::bigint AS steps_fail,
        COALESCE(SUM(inner_gas_used), 0)::numeric(78,0) AS inner_gas_total,
        COALESCE(SUM(tx_gas_used), 0)::numeric(78,0) AS tx_gas_total,
        COALESCE(SUM(COALESCE(donation_fee, 0) + COALESCE(validator_fee, 0) + COALESCE(burned_fee, 0)), 0)::numeric(78,0) AS fees_total
      FROM mv_session_steps
      ${whereSql}
      GROUP BY 1
      ORDER BY bucket ASC
      LIMIT ${TIMESERIES_LIMIT}
    `,
    [...params, bucket]
  );
  return result.rows.map(mapStepTimeseriesRow);
}

export async function getXdalaActiveSessionsTimeseries(
  input: XdalaActiveSessionsTimeseriesInput = {}
): Promise<XdalaActiveSessionsTimeseriesRow[]> {
  const windowHours = normalizeWindowHours(input.windowHours);
  const params: unknown[] = [];
  const where = buildBucketWindowWhere('bucket', 'hour', windowHours, params);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await explorerDbQuery<ActiveSessionsTimeseriesRow>(
    `
      SELECT
        bucket,
        active_sessions
      FROM mv_sessions_active_hour
      ${whereSql}
      ORDER BY bucket ASC
      LIMIT ${TIMESERIES_LIMIT}
    `,
    params
  );

  return result.rows.map(mapActiveSessionsTimeseriesRow);
}
const PAYLOAD_SOURCE_COLUMNS: Record<XdalaPayloadSource, string> = {
  payload: 'r.engine_payload',
  apiSaves: 'r.engine_api_saves',
  contractSaves: 'r.engine_contract_saves',
  extras: 'r.engine_extras'
};

function normalizePayloadSource(source: XdalaPayloadSource | undefined): XdalaPayloadSource {
  if (source === 'apiSaves' || source === 'contractSaves' || source === 'extras') return source;
  return 'payload';
}

function normalizePayloadTermMode(mode: XdalaPayloadTermMode | undefined): XdalaPayloadTermMode {
  if (mode === 'keys' || mode === 'values') return mode;
  return 'keys_and_values';
}

function normalizeMinTermLength(minTermLength: number | undefined): number {
  if (!Number.isFinite(minTermLength)) return 2;
  return Math.min(Math.max(Math.trunc(minTermLength ?? 2), 1), 64);
}

function addPayloadAnalyticsFilters(
  where: string[],
  params: unknown[],
  input: { owner?: string; windowHours?: number; outcome?: XdalaSessionOutcomeFilter }
): void {
  addSessionDiscoveryFilters(where, params, input);
}

function payloadRowsCte(payloadColumn: string, whereSql: string): string {
  return `
    WITH selected_sessions AS (
      SELECT owner, session_id
      FROM mv_sessions
      ${whereSql}
    ),
    receipt_payloads AS (
      SELECT
        s.owner,
        s.session_id,
        COALESCE(${payloadColumn}, '{}'::jsonb) AS payload_doc
      FROM selected_sessions s
      JOIN tx_receipts r
        ON lower(r.receipt_from_address) = s.owner
       AND r.engine_session_id = s.session_id
      WHERE jsonb_typeof(COALESCE(${payloadColumn}, '{}'::jsonb)) = 'object'
    )`;
}

function mapPayloadKeyStatsRow(row: PayloadKeyStatsRow): XdalaPayloadKeyStat {
  return {
    key: row.key,
    occurrences: valueOrZero(row.occurrences),
    sessionsWithKey: valueOrZero(row.sessions_with_key),
    emptyCount: valueOrZero(row.empty_count),
    nonEmptyCount: valueOrZero(row.non_empty_count)
  };
}

function mapPayloadTermStatsRow(row: PayloadTermStatsRow): XdalaPayloadTermStat {
  return {
    term: row.term,
    occurrences: valueOrZero(row.occurrences),
    sessionsWithTerm: valueOrZero(row.sessions_with_term),
    sourceKinds: row.source_kinds ?? ''
  };
}

function mapPayloadFieldValueStatsRow(row: PayloadFieldValueStatsRow): XdalaPayloadFieldValueStat {
  return {
    field: row.field,
    value: row.value,
    occurrences: valueOrZero(row.occurrences),
    sessionsWithValue: valueOrZero(row.sessions_with_value)
  };
}

export async function getXdalaPayloadKeyStats(input: XdalaPayloadAnalyticsInput = {}): Promise<XdalaPayloadKeyStat[]> {
  const limit = normalizeCappedLimit(input.limit, 100, 500);
  const source = normalizePayloadSource(input.source);
  const payloadColumn = PAYLOAD_SOURCE_COLUMNS[source];
  const params: unknown[] = [];
  const where: string[] = [];
  addPayloadAnalyticsFilters(where, params, input);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  params.push(limit);
  const result = await explorerDbQuery<PayloadKeyStatsRow>(
    `
      ${payloadRowsCte(payloadColumn, whereSql)},
      field_values AS (
        SELECT
          p.owner,
          p.session_id,
          entry.key,
          entry.value
        FROM receipt_payloads p
        CROSS JOIN LATERAL jsonb_each(p.payload_doc) AS entry(key, value)
      )
      SELECT
        key,
        COUNT(*)::bigint AS occurrences,
        COUNT(DISTINCT (owner, session_id))::bigint AS sessions_with_key,
        COUNT(*) FILTER (
          WHERE value = 'null'::jsonb
             OR value = '""'::jsonb
             OR value = '{}'::jsonb
             OR value = '[]'::jsonb
        )::bigint AS empty_count,
        COUNT(*) FILTER (
          WHERE NOT (
            value = 'null'::jsonb
            OR value = '""'::jsonb
            OR value = '{}'::jsonb
            OR value = '[]'::jsonb
          )
        )::bigint AS non_empty_count
      FROM field_values
      GROUP BY key
      ORDER BY occurrences DESC, sessions_with_key DESC, key ASC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows.map(mapPayloadKeyStatsRow);
}

export async function getXdalaPayloadTermStats(input: XdalaPayloadTermStatsInput = {}): Promise<XdalaPayloadTermStat[]> {
  const limit = normalizeCappedLimit(input.limit, 100, 500);
  const source = normalizePayloadSource(input.source);
  const mode = normalizePayloadTermMode(input.mode);
  const minTermLength = normalizeMinTermLength(input.minTermLength);
  const payloadColumn = PAYLOAD_SOURCE_COLUMNS[source];
  const params: unknown[] = [];
  const where: string[] = [];
  addPayloadAnalyticsFilters(where, params, input);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const includeKeys = mode === 'keys' || mode === 'keys_and_values';
  const includeValues = mode === 'values' || mode === 'keys_and_values';
  const entryQueries: string[] = [];

  if (includeKeys) {
    entryQueries.push(`
      SELECT p.owner, p.session_id, 'key'::text AS source_kind, entry.key AS term_text
      FROM receipt_payloads p
      CROSS JOIN LATERAL jsonb_each(p.payload_doc) AS entry(key, value)`);
  }

  if (includeValues) {
    entryQueries.push(`
      SELECT p.owner, p.session_id, 'value'::text AS source_kind, entry.value #>> '{}' AS term_text
      FROM receipt_payloads p
      CROSS JOIN LATERAL jsonb_each(p.payload_doc) AS entry(key, value)
      WHERE jsonb_typeof(entry.value) IN ('string', 'number', 'boolean')`);
  }

  params.push(minTermLength, limit);
  const minTermLengthParam = params.length - 1;
  const limitParam = params.length;
  const result = await explorerDbQuery<PayloadTermStatsRow>(
    `
      ${payloadRowsCte(payloadColumn, whereSql)},
      term_sources AS (
        ${entryQueries.join('\n        UNION ALL\n')}
      ),
      tokens AS (
        SELECT
          owner,
          session_id,
          source_kind,
          trim(token) AS term
        FROM term_sources
        CROSS JOIN LATERAL regexp_split_to_table(lower(COALESCE(term_text, '')), '[^[:alnum:]]+') AS token
      ),
      filtered_tokens AS (
        SELECT owner, session_id, source_kind, term
        FROM tokens
        WHERE term <> ''
          AND length(term) >= $${minTermLengthParam}
      )
      SELECT
        term,
        COUNT(*)::bigint AS occurrences,
        COUNT(DISTINCT (owner, session_id))::bigint AS sessions_with_term,
        string_agg(DISTINCT source_kind, ',' ORDER BY source_kind) AS source_kinds
      FROM filtered_tokens
      GROUP BY term
      ORDER BY occurrences DESC, sessions_with_term DESC, term ASC
      LIMIT $${limitParam}
    `,
    params
  );

  return result.rows.map(mapPayloadTermStatsRow);
}

export async function getXdalaPayloadFieldValueStats(input: XdalaPayloadFieldValueStatsInput): Promise<XdalaPayloadFieldValueStat[]> {
  const limit = normalizeCappedLimit(input.limit, 50, 200);
  const source = normalizePayloadSource(input.source);
  const payloadColumn = PAYLOAD_SOURCE_COLUMNS[source];
  const params: unknown[] = [];
  const where: string[] = [];
  addPayloadAnalyticsFilters(where, params, input);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  params.push(input.field, limit);
  const fieldParam = params.length - 1;
  const limitParam = params.length;
  const result = await explorerDbQuery<PayloadFieldValueStatsRow>(
    `
      ${payloadRowsCte(payloadColumn, whereSql)},
      field_values AS (
        SELECT
          p.owner,
          p.session_id,
          $${fieldParam}::text AS field,
          CASE
            WHEN p.payload_doc ? ($${fieldParam}::text) THEN left(p.payload_doc ->> ($${fieldParam}::text), 256)
            ELSE NULL
          END AS value
        FROM receipt_payloads p
        WHERE p.payload_doc ? ($${fieldParam}::text)
      )
      SELECT
        field,
        value,
        COUNT(*)::bigint AS occurrences,
        COUNT(DISTINCT (owner, session_id))::bigint AS sessions_with_value
      FROM field_values
      GROUP BY field, value
      ORDER BY occurrences DESC, sessions_with_value DESC, value ASC NULLS LAST
      LIMIT $${limitParam}
    `,
    params
  );

  return result.rows.map(mapPayloadFieldValueStatsRow);
}
