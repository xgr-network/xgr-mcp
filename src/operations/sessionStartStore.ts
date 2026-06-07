import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { rpcCall } from '../adapters/rpcClient.js';
import { readXrc137RuleJson, readXrc729OstcJson } from '../adapters/contractReadClient.js';
import { listXrc729OstcStateDb } from '../adapters/xrcDbClient.js';
import { renderRuntimeMermaid } from '../knowledge/xdalaMermaid.js';
import { getBundleDeployHandoff } from './bundleDeployStore.js';

export type SessionStartStatus = 'pending_import' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'expired';
export type AuthorityStatus = 'not_checked' | 'owner_verified' | 'executor_verified' | 'wildcard_executor' | 'signer_not_authorized' | 'authority_unavailable';
export type SessionStartSource = { type: 'runtime'; orchestration: string; ostcId: string } | { type: 'bundle_deploy_result'; bundleDeployHandle: string } | { type: 'direct' };

export type XgrSessionStartRequest = {
  type: 'xdala_session_start';
  version: 'xgr-session-start@1';
  handle: string;
  summary?: Record<string, unknown>;
  mode?: 'single' | 'queue';
  sessions: Array<Record<string, unknown> & { orchestration: string; ostcId: string; stepId: string; payload: Record<string, unknown>; maxTotalGas: number }>;
  execution?: Record<string, unknown>;
  signing?: Record<string, unknown>;
  executorGrants?: Record<string, unknown>;
  chain?: Record<string, unknown>;
  ui?: Record<string, unknown>;
  security?: Record<string, unknown>;
};

export type NormalizedSessionStartResult = {
  handle: string;
  type: 'xdala_session_start_result';
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  completedAt: string;
  receivedAt: string;
  inputType: 'singleSession' | 'sessionQueue';
  originalRequest: Record<string, unknown>;
  results: Array<Record<string, unknown>>;
};

export type XdalaSessionStartRecord = {
  handle: string;
  type: 'xdala_session_start_handoff';
  version: 'xgr-session-start@1';
  network: string;
  chainId: number;
  status: SessionStartStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  source: SessionStartSource;
  request: XgrSessionStartRequest;
  authority: {
    requiredRole: 'owner_or_executor';
    owner?: string;
    executors?: string[];
    executorWildcard?: boolean;
    expectedSigner?: string;
    authorityStatus: AuthorityStatus;
    canStart: boolean;
    reason?: string;
  };
  validation: {
    valid: boolean;
    errors: Array<Record<string, unknown>>;
    warnings: Array<Record<string, unknown>>;
    requiredPayload?: string[];
    missingPayload?: string[];
  };
  graph?: { mermaid?: string; nodes?: unknown[]; edges?: unknown[]; warnings?: unknown[] };
  result?: NormalizedSessionStartResult;
  events: Array<Record<string, unknown>>;
};

export type SessionOwnershipSummary = {
  xrc729ContractOwner?: string;
  allowedExecutors?: string[];
  executorWildcard?: boolean;
  intendedStarterAddresses?: string[];
  actualSessionOwners?: string[];
  status: 'not_final' | 'actual_recorded';
  note: string;
};

export type SessionStartResultSummary = {
  status: 'not_available' | 'completed' | 'partial' | 'failed' | 'cancelled';
  total: number;
  ok: number;
  failed: number;
  owners: string[];
  sessionIds: string[];
  pids: string[];
  orchestrations: string[];
  ostcIds: string[];
  stepIds: string[];
  evidenceReady: boolean;
};

export type PublicSessionStartRecord = XdalaSessionStartRecord & { xdalaUrl: string; fetchUrl: string; sessionOwnership: SessionOwnershipSummary; resultSummary: SessionStartResultSummary };

const HANDLE_RE = /^ss_[A-Za-z0-9_-]{48,125}$/;
const WORKBENCH_HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO = '0x0000000000000000000000000000000000000000';
const terminalStatuses = new Set<SessionStartStatus>(['completed', 'partial', 'failed', 'cancelled', 'expired']);
const resultStatuses = new Set(['completed', 'partial', 'failed', 'cancelled']);
const resultInputTypes = new Set(['singleSession', 'sessionQueue']);
const resultTopLevelKeys = new Set(['handle', 'type', 'status', 'completedAt', 'inputType', 'originalRequest', 'results']);
const resultEntryKeysOk = new Set(['ok', 'index', 'status', 'sessionId', 'owner', 'starter']);
const resultEntryKeysFail = new Set(['ok', 'index', 'status', 'stage', 'starter', 'error']);
const resultEntryStatusOk = new Set(['started']);
const resultEntryStatusFail = new Set(['failed', 'cancelled', 'not_started']);
const resultEntryStageFail = new Set(['start', 'cancelled', 'not_started']);
const originalRequestKeys = new Set(['type', 'version', 'handle', 'summary', 'mode', 'sessions', 'chain']);
const originalRequestChainKeys = new Set(['network', 'requiredChainIdHex', 'requiredChainIdDec']);
const redactKeys = new Set(['__secret', '__secret1', '__secret2', 'privateKey', 'mnemonic', 'seed', 'permit', 'signature']);
const redactedPlaceholder = '[redacted]';
const topLevelKeys = new Set(['type', 'version', 'handle', 'summary', 'mode', 'sessions', 'execution', 'signing', 'executorGrants', 'chain', 'ui', 'security']);
const bannedKeyRe = /(private[_-]?key|mnemonic|seedphrase|seed_phrase|permit|signature|walletsecret|wallet_secret)/i;
const now = () => new Date().toISOString();
const dir = () => resolve(env.sessionStart.storeDir);
const clean = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '');
const fileFor = (handle: string) => join(dir(), `${clean(handle)}.json`);

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
}
async function ensureDir(): Promise<void> { if (!existsSync(dir())) await mkdir(dir(), { recursive: true }); }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isExpired(record: XdalaSessionStartRecord): boolean { return Date.now() > Date.parse(record.expiresAt); }
function isIso(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function normAddr(value: unknown): string | undefined { return typeof value === 'string' && ADDRESS_RE.test(value) ? value.toLowerCase() : undefined; }
function addIssue(list: Array<Record<string, unknown>>, code: string, message: string, path?: string): void { list.push({ code, message, ...(path ? { path } : {}) }); }
function deepEqual(left: unknown, right: unknown): boolean { return jsonStringify(left) === jsonStringify(right); }
function containsLeak(value: unknown): boolean {
  const visit = (item: unknown, key = ''): boolean => {
    if (bannedKeyRe.test(key)) return true;
    if (Array.isArray(item)) return item.some((v, i) => visit(v, String(i)));
    if (isPlainRecord(item)) return Object.entries(item).some(([k, v]) => bannedKeyRe.test(k) || visit(v, k));
    return false;
  };
  return visit(value);
}
function containsCallbackLeak(value: unknown): boolean {
  const visit = (item: unknown, key = ''): boolean => {
    const sensitiveKey = redactKeys.has(key) || /^__secret\d*$/.test(key);
    if (sensitiveKey && item !== redactedPlaceholder) return true;
    if (Array.isArray(item)) return item.some((v, i) => visit(v, String(i)));
    if (isPlainRecord(item)) return Object.entries(item).some(([k, v]) => visit(v, k));
    return false;
  };
  return visit(value);
}
function validateWakeAndSecrets(payload: Record<string, unknown>, errors: Array<Record<string, unknown>>, prefix: string): void {
  if ('__wakeup' in payload) addIssue(errors, 'LEGACY_WAKEUP_INVALID', 'payload.__wakeup is not valid; use __wakeUp.', `${prefix}.__wakeup`);
  if ('__wakeUp' in payload && !isPlainRecord(payload.__wakeUp) && !Array.isArray(payload.__wakeUp) && typeof payload.__wakeUp !== 'string') addIssue(errors, 'WAKEUP_INVALID', 'payload.__wakeUp must be an object, array, or string.', `${prefix}.__wakeUp`);
  for (const [key, value] of Object.entries(payload)) {
    if (/^__secret\d*$/.test(key) && (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))) addIssue(errors, 'SECRET_INVALID', `${key} must be a 1..512 character string without control characters.`, `${prefix}.${key}`);
  }
}
export function validateSessionStartRequest(request: unknown): { valid: boolean; errors: Array<Record<string, unknown>>; warnings: Array<Record<string, unknown>> } {
  const errors: Array<Record<string, unknown>> = [];
  const warnings: Array<Record<string, unknown>> = [];
  if (!isPlainRecord(request)) return { valid: false, errors: [{ code: 'REQUEST_INVALID', message: 'request must be an object' }], warnings };
  for (const key of Object.keys(request)) if (!topLevelKeys.has(key)) addIssue(errors, 'ADDITIONAL_PROPERTY', `unsupported top-level property ${key}`, key);
  if (request.type !== 'xdala_session_start') addIssue(errors, 'TYPE_INVALID', 'type must be xdala_session_start', 'type');
  if (request.version !== 'xgr-session-start@1') addIssue(errors, 'VERSION_INVALID', 'version must be xgr-session-start@1', 'version');
  if (typeof request.handle !== 'string' || !WORKBENCH_HANDLE_RE.test(request.handle) || !HANDLE_RE.test(request.handle)) addIssue(errors, 'HANDLE_INVALID', 'handle must be an ss_ bearer handle matching the Workbench schema', 'handle');
  if (request.mode !== undefined && request.mode !== 'single' && request.mode !== 'queue') addIssue(errors, 'MODE_INVALID', 'mode must be single or queue', 'mode');
  if (!Array.isArray(request.sessions) || request.sessions.length < 1 || request.sessions.length > 100) addIssue(errors, 'SESSIONS_INVALID', 'sessions length must be 1..100', 'sessions');
  else request.sessions.forEach((session, index) => {
    const path = `sessions.${index}`;
    if (!isPlainRecord(session)) { addIssue(errors, 'SESSION_INVALID', 'session must be an object', path); return; }
    if (typeof session.orchestration !== 'string' || !ADDRESS_RE.test(session.orchestration)) addIssue(errors, 'ORCHESTRATION_INVALID', 'orchestration must be a 20-byte 0x address', `${path}.orchestration`);
    if (typeof session.ostcId !== 'string' || !session.ostcId) addIssue(errors, 'OSTC_ID_INVALID', 'ostcId is required', `${path}.ostcId`);
    if (session.ostcHash !== undefined && (typeof session.ostcHash !== 'string' || !BYTES32_RE.test(session.ostcHash))) addIssue(errors, 'OSTC_HASH_INVALID', 'ostcHash must be bytes32 when present', `${path}.ostcHash`);
    if (typeof session.stepId !== 'string' || !session.stepId) addIssue(errors, 'STEP_ID_INVALID', 'stepId is required', `${path}.stepId`);
    if (!isPlainRecord(session.payload)) addIssue(errors, 'PAYLOAD_INVALID', 'payload must be an object', `${path}.payload`); else validateWakeAndSecrets(session.payload, errors, `${path}.payload`);
    if (!Number.isSafeInteger(session.maxTotalGas) || Number(session.maxTotalGas) < 0) addIssue(errors, 'MAX_GAS_INVALID', 'maxTotalGas must be a non-negative safe integer', `${path}.maxTotalGas`);
    if (session.expiry !== undefined && (!Number.isSafeInteger(session.expiry) || Number(session.expiry) <= 0)) addIssue(errors, 'EXPIRY_INVALID', 'expiry must be a positive integer', `${path}.expiry`);
    if (session.starterAddress !== undefined && !normAddr(session.starterAddress)) addIssue(errors, 'STARTER_INVALID', 'starterAddress must be a 20-byte 0x address', `${path}.starterAddress`);
  });
  if (isPlainRecord(request.execution) && request.execution.sessionConcurrency !== undefined && request.execution.sessionConcurrency !== 1) addIssue(errors, 'CONCURRENCY_INVALID', 'execution.sessionConcurrency must be 1', 'execution.sessionConcurrency');
  if (isPlainRecord(request.chain) && request.chain.rpcPolicy !== undefined && request.chain.rpcPolicy !== 'useOpsConnectedRpc') addIssue(errors, 'RPC_POLICY_INVALID', 'chain.rpcPolicy must be useOpsConnectedRpc', 'chain.rpcPolicy');
  if (isPlainRecord(request.security) && request.security.redactSecretsInLogs !== undefined && request.security.redactSecretsInLogs !== true) addIssue(errors, 'REDACTION_INVALID', 'security.redactSecretsInLogs must be true', 'security.redactSecretsInLogs');
  if (containsLeak(request)) addIssue(errors, 'SENSITIVE_FIELD_REJECTED', 'request contains a disallowed sensitive field name');
  return { valid: errors.length === 0, errors, warnings };
}
function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function stringField(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }

function sessionOwnershipSummary(record: XdalaSessionStartRecord): SessionOwnershipSummary {
  const intendedStarterAddresses = uniqueStrings(record.request.sessions.map((session) => normAddr(session.starterAddress)));
  const actualSessionOwners = uniqueStrings(record.result?.results.map((result) => normAddr(result.owner)) ?? []);
  if (actualSessionOwners.length > 0) {
    return {
      ...(record.authority.owner ? { xrc729ContractOwner: record.authority.owner } : {}),
      ...(record.authority.executors ? { allowedExecutors: record.authority.executors } : {}),
      ...(record.authority.executorWildcard !== undefined ? { executorWildcard: record.authority.executorWildcard } : {}),
      ...(intendedStarterAddresses.length > 0 ? { intendedStarterAddresses } : {}),
      actualSessionOwners,
      status: 'actual_recorded',
      note: 'Actual session owner/starter was taken from terminal Workbench result data. The XRC-729 contract owner is only a start-authority role and is not assumed to own sessions.'
    };
  }
  return {
    ...(record.authority.owner ? { xrc729ContractOwner: record.authority.owner } : {}),
    ...(record.authority.executors ? { allowedExecutors: record.authority.executors } : {}),
    ...(record.authority.executorWildcard !== undefined ? { executorWildcard: record.authority.executorWildcard } : {}),
    ...(intendedStarterAddresses.length > 0 ? { intendedStarterAddresses } : {}),
    status: 'not_final',
    note: intendedStarterAddresses.length > 0
      ? 'The handoff includes intended starterAddress value(s), but the actual session owner/starter is not final until Workbench starts the session and returns terminal result data.'
      : 'No starterAddress or terminal result exists yet; the actual session owner/starter is not final. Do not treat the XRC-729 contract owner as the owner of a not-yet-started session.'
  };
}

function resultSummary(record: XdalaSessionStartRecord): SessionStartResultSummary {
  if (!record.result) {
    return { status: 'not_available', total: 0, ok: 0, failed: 0, owners: [], sessionIds: [], pids: [], orchestrations: [], ostcIds: [], stepIds: [], evidenceReady: false };
  }

  const results = record.result.results;
  const ok = results.filter((result) => result.ok === true).length;
  const sessionIds = uniqueStrings(results.map((result) => stringField(result.sessionId)));
  return {
    status: record.result.status,
    total: results.length,
    ok,
    failed: results.filter((result) => result.ok === false).length,
    owners: uniqueStrings(results.map((result) => stringField(result.owner))),
    sessionIds,
    pids: [],
    orchestrations: uniqueStrings(record.request.sessions.map((session) => normAddr(session.orchestration))),
    ostcIds: uniqueStrings(record.request.sessions.map((session) => stringField(session.ostcId))),
    stepIds: uniqueStrings(record.request.sessions.map((session) => stringField(session.stepId))),
    evidenceReady: ok > 0 && sessionIds.length > 0
  };
}

function toPublic(record: XdalaSessionStartRecord): PublicSessionStartRecord { return { ...record, ...sessionStartLinks(record.handle), sessionOwnership: sessionOwnershipSummary(record), resultSummary: resultSummary(record) }; }
export function sessionStartLinks(handle: string): { xdalaUrl: string; fetchUrl: string } { return { xdalaUrl: `${env.sessionStart.xdalaBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(handle)}`, fetchUrl: `${env.operations.publicBaseUrl.replace(/\/+$/, '')}/api/session-start/${encodeURIComponent(handle)}` }; }
async function readRecord(handle: string): Promise<XdalaSessionStartRecord | null> { await ensureDir(); if (clean(handle) !== handle || !HANDLE_RE.test(handle)) return null; const path = fileFor(handle); if (!existsSync(path)) return null; return JSON.parse(await readFile(path, 'utf8')) as XdalaSessionStartRecord; }
async function save(record: XdalaSessionStartRecord): Promise<void> { await ensureDir(); record.updatedAt = now(); await writeFile(fileFor(record.handle), `${jsonStringify(record)}\n`, 'utf8'); }
async function enforceTtl(record: XdalaSessionStartRecord): Promise<XdalaSessionStartRecord> { if (isExpired(record) && !terminalStatuses.has(record.status)) { record.status = 'expired'; record.events.push({ at: now(), type: 'expired' }); await save(record); } return record; }

function decodeAddress(data: string): string | undefined { const hex = data.replace(/^0x/, ''); if (hex.length < 64) return undefined; const addr = `0x${hex.slice(24, 64)}`; return normAddr(addr); }
function decodeAddressArray(data: string): string[] | undefined {
  const hex = data.replace(/^0x/, ''); if (hex.length < 128) return undefined;
  const offset = Number(BigInt(`0x${hex.slice(0, 64)}`)); const lenPos = offset * 2; if (!Number.isSafeInteger(offset) || hex.length < lenPos + 64) return undefined;
  const len = Number(BigInt(`0x${hex.slice(lenPos, lenPos + 64)}`)); if (!Number.isSafeInteger(len) || len < 0 || len > 10000) return undefined;
  const out: string[] = []; for (let i = 0; i < len; i++) { const word = hex.slice(lenPos + 64 + i * 64, lenPos + 128 + i * 64); const addr = normAddr(`0x${word.slice(24)}`); if (addr) out.push(addr); }
  return out;
}
async function ethCall(address: string, data: `0x${string}`): Promise<string> { return rpcCall<string>('eth_call', [{ to: address, data }, 'latest']); }
export async function resolveSessionStartAuthority(orchestration: string, expectedSigner?: string): Promise<{ authority: XdalaSessionStartRecord['authority']; warnings: Array<Record<string, unknown>> }> {
  const warnings: Array<Record<string, unknown>> = [];
  const signer = normAddr(expectedSigner);
  let owner: string | undefined; let executors: string[] | undefined; let executorWildcard = false; let ownerOk = false; let execOk = false;
  try { owner = decodeAddress(await ethCall(orchestration, '0x8da5cb5b')); ownerOk = Boolean(owner); } catch {}
  if (!owner) { try { owner = decodeAddress(await ethCall(orchestration, '0x893d20e8')); ownerOk = Boolean(owner); } catch {} }
  try { const decodedExecutors = decodeAddressArray(await ethCall(orchestration, '0x9e8f4b8f')); executors = decodedExecutors ?? []; execOk = Boolean(decodedExecutors); executorWildcard = executors.includes(ZERO); executors = executors.filter((a) => a !== ZERO); } catch { addIssue(warnings, 'EXECUTOR_LIST_UNAVAILABLE', 'getExecutorList() could not be read.'); }
  let authorityStatus: AuthorityStatus = signer ? 'authority_unavailable' : 'not_checked'; let canStart = false;
  if (signer && owner && signer === owner) { authorityStatus = 'owner_verified'; canStart = true; }
  else if (signer && execOk && executors?.includes(signer)) { authorityStatus = 'executor_verified'; canStart = true; }
  else if (signer && execOk && executorWildcard) { authorityStatus = 'wildcard_executor'; canStart = true; }
  else if (signer && ownerOk && execOk) { authorityStatus = 'signer_not_authorized'; }
  else if (!signer && (ownerOk || execOk)) { authorityStatus = 'not_checked'; }
  else { authorityStatus = 'authority_unavailable'; addIssue(warnings, 'AUTHORITY_UNAVAILABLE', 'owner/executor authority could not be fully resolved.'); }
  return { authority: { requiredRole: 'owner_or_executor', owner, executors, executorWildcard, expectedSigner: signer, authorityStatus, canStart, reason: canStart ? undefined : 'Connect wallet or unlock signer in xDaLa Workbench to verify owner/executor authority before starting.' }, warnings };
}


type SessionStartChainExpectation = { chainId: number; requiredChainIdHex: string; requiredChainIdDec: string };

async function readSessionStartChainExpectation(): Promise<SessionStartChainExpectation> {
  try {
    const raw = await rpcCall<string>('eth_chainId');
    if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error('invalid eth_chainId response');
    const parsed = BigInt(raw);
    if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('eth_chainId is out of range');
    const chainId = Number(parsed);
    return { chainId, requiredChainIdHex: `0x${parsed.toString(16)}`, requiredChainIdDec: parsed.toString(10) };
  } catch {
    throw new Error('failed to read chainId from configured RPC');
  }
}

function chainForRequest(network: string, expectation: SessionStartChainExpectation, existing?: unknown): Record<string, unknown> {
  if (!isPlainRecord(existing)) return { network, requiredChainIdHex: expectation.requiredChainIdHex, requiredChainIdDec: expectation.requiredChainIdDec, rpcPolicy: 'useOpsConnectedRpc' };
  if (existing.network !== undefined && existing.network !== network) throw new Error('request.chain.network must match input network');
  return { ...existing, network: typeof existing.network === 'string' ? existing.network : network, requiredChainIdHex: expectation.requiredChainIdHex, requiredChainIdDec: expectation.requiredChainIdDec, rpcPolicy: 'useOpsConnectedRpc' };
}

function parseMaybeJson(value: unknown): unknown { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } }
function stepArray(structure: unknown): Array<Record<string, unknown> & { id: string }> {
  const parsed = parseMaybeJson(structure); if (!isPlainRecord(parsed)) return [];
  const candidate = parsed.structure ?? parsed.steps;
  if (Array.isArray(candidate)) return candidate.filter(isPlainRecord).map((s, i) => ({ ...s, id: String(s.id ?? s.stepId ?? `step_${i}`) }));
  if (isPlainRecord(candidate)) return Object.entries(candidate).map(([id, v]) => ({ ...(isPlainRecord(v) ? v : {}), id }));
  return [];
}
function branchTargets(v: unknown): string[] { if (typeof v === 'string') return [v]; if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string'); if (isPlainRecord(v) && Array.isArray(v.spawns)) return v.spawns.filter((x): x is string => typeof x === 'string'); return []; }
function inferEntry(steps: Array<Record<string, unknown> & { id: string }>, warnings: Array<Record<string, unknown>>): string | undefined {
  if (!steps.length) return undefined; const incoming = new Set<string>(); for (const s of steps) for (const t of [...branchTargets(s.onValid), ...branchTargets(s.onInvalid)]) incoming.add(t);
  const entries = steps.filter((s) => !incoming.has(s.id)); if (entries.length === 1) return entries[0].id; addIssue(warnings, 'ENTRY_STEP_INFERRED_LOW_CONFIDENCE', 'Entry step was inferred with low confidence.'); return steps[0].id;
}
function ruleRefOf(step: Record<string, unknown>): string | undefined { const r = step.rule ?? step.ruleAddress ?? step.xrc137 ?? step.rule_contract; if (typeof r === 'string') return r; if (isPlainRecord(r)) return typeof r.address === 'string' ? r.address : undefined; return undefined; }
function requiredFromRule(rule: unknown): string[] { const parsed = parseMaybeJson(rule); if (!isPlainRecord(parsed) || !isPlainRecord(parsed.payload)) return []; return Object.entries(parsed.payload).filter(([, v]) => isPlainRecord(v) && !Object.prototype.hasOwnProperty.call(v, 'default')).map(([k]) => k).sort(); }
function missing(required: string[], payload: Record<string, unknown>): string[] { return required.filter((key) => !(key in payload)); }
function defaultsFor(count: number, input: Record<string, unknown>): Pick<XgrSessionStartRequest, 'execution' | 'signing' | 'ui' | 'security'> { const mode = count === 1 ? 'import' : 'queue'; return { execution: { startPolicy: 'manual', verifyOnChain: true, stopOnStartFailure: true, stopOnVerifyFailure: true, sessionConcurrency: 1, ...(isPlainRecord(input.execution) ? input.execution : {}) }, signing: { mode: 'wallet', allowWalletFallback: false, ...(isPlainRecord(input.signing) ? input.signing : {}) }, ui: { openMode: mode, highlightStartAction: true, ...(isPlainRecord(input.ui) ? input.ui : {}) }, security: { redactSecretsInLogs: true, maxPayloadBytes: 10485760, ...(isPlainRecord(input.security) ? input.security : {}) } }; }
function makeSessions(orchestration: string, ostcId: string, ostcHash: string | undefined, selected: Array<Record<string, unknown>>, fallback: Record<string, unknown>): XgrSessionStartRequest['sessions'] { return selected.map((s) => ({ ...(typeof s.__uid === 'string' ? { __uid: s.__uid } : {}), orchestration, ostcId, ...(ostcHash ? { ostcHash } : {}), stepId: String(s.stepId ?? fallback.stepId), payload: isPlainRecord(s.payload) ? s.payload : (isPlainRecord(fallback.payload) ? fallback.payload : {}), maxTotalGas: Number.isSafeInteger(s.maxTotalGas) ? Number(s.maxTotalGas) : (Number.isSafeInteger(fallback.maxTotalGas) ? Number(fallback.maxTotalGas) : 0), ...(Number.isSafeInteger(s.expiry) ? { expiry: s.expiry as number } : (Number.isSafeInteger(fallback.expiry) ? { expiry: fallback.expiry as number } : {})), ...(normAddr(s.starterAddress) ? { starterAddress: normAddr(s.starterAddress) } : {}) })); }

export async function createSessionStartHandoff(input: Record<string, unknown>): Promise<PublicSessionStartRecord> {
  if (typeof input.network !== 'string' || input.network.trim().length === 0) throw new Error('network is required');
  if (input.chainId !== undefined && (!Number.isSafeInteger(input.chainId) || Number(input.chainId) <= 0)) throw new Error('chainId must be a positive integer when provided');
  const chainExpectation = await readSessionStartChainExpectation();
  if (input.chainId !== undefined && Number(input.chainId) !== chainExpectation.chainId) throw new Error(`chainId mismatch: input expected ${Number(input.chainId)}, RPC returned ${chainExpectation.chainId}`);
  const sourceType = input.source; if (sourceType !== 'runtime' && sourceType !== 'bundle_deploy_result' && sourceType !== 'direct') throw new Error('source must be runtime, bundle_deploy_result, or direct');
  const handle = `ss_${randomBytes(24).toString('hex')}`; const createdAt = now(); const validation = { valid: true, errors: [] as Array<Record<string, unknown>>, warnings: [] as Array<Record<string, unknown>>, requiredPayload: [] as string[], missingPayload: [] as string[] };
  let source: SessionStartSource; let request: XgrSessionStartRequest; let graph: XdalaSessionStartRecord['graph']; let authorityOrchestration: string | undefined;
  if (sourceType === 'direct') {
    if (!isPlainRecord(input.request)) throw new Error('request is required for direct source');
    if (typeof input.request.handle === 'string' && input.request.handle !== handle) throw new Error('request.handle must be omitted for MCP-generated handles');
    request = { ...input.request, handle, chain: chainForRequest(input.network, chainExpectation, input.request.chain) } as XgrSessionStartRequest; const check = validateSessionStartRequest(request); if (!check.valid) throw new Error(`invalid xgr-session-start@1 request: ${check.errors.map((e) => e.message).join('; ')}`); validation.warnings.push(...check.warnings); source = { type: 'direct' }; authorityOrchestration = request.sessions[0]?.orchestration;
  } else {
    let orchestration = normAddr(input.orchestration); let ostcId = typeof input.ostcId === 'string' ? input.ostcId : undefined; let ostcHash = typeof input.ostcHash === 'string' && BYTES32_RE.test(input.ostcHash) ? input.ostcHash : undefined; let structure: unknown; const ruleMap = new Map<string, unknown>();
    if (sourceType === 'bundle_deploy_result') {
      if (typeof input.bundleDeployHandle !== 'string') throw new Error('bundleDeployHandle is required'); const bd = await getBundleDeployHandoff(input.bundleDeployHandle, { mutateExpired: false }); if (!bd || bd.status !== 'deployed') throw new Error('bundle deploy handoff must exist with status deployed'); const artifact = (isPlainRecord(bd.result?.artifact) ? bd.result?.artifact : bd.deployedArtifact) as Record<string, unknown> | undefined; if (!isPlainRecord(artifact)) throw new Error('bundle deploy result artifact is required');
      const items = Array.isArray(artifact.items) ? artifact.items.filter(isPlainRecord) : (Array.isArray(artifact.bundles) && isPlainRecord(artifact.bundles[0]) && Array.isArray(artifact.bundles[0].items) ? artifact.bundles[0].items.filter(isPlainRecord) : []);
      const x729 = items.find((i) => isPlainRecord(i.meta) && i.meta.type === 'xrc729') ?? artifact; orchestration = normAddr(x729.address ?? (isPlainRecord(x729.meta) ? x729.meta.deployedAddress : undefined)); if (!orchestration) throw new Error('deployed XRC-729 address missing from bundle deploy result'); ostcId = ostcId ?? String((x729.ostcId ?? x729.id ?? (isPlainRecord(x729.meta) ? x729.meta.ostcId : '')) || 'default'); ostcHash = ostcHash ?? (typeof x729.ostcHash === 'string' ? x729.ostcHash : undefined); structure = x729.structure ?? artifact.structure;
      for (const i of items.filter((item) => isPlainRecord(item.meta) && item.meta.type === 'xrc137')) { const meta = isPlainRecord(i.meta) ? i.meta : {}; const alias = typeof meta.alias === 'string' ? meta.alias : undefined; if (alias) ruleMap.set(`cm:xrc137:${alias}`, i); const addr = normAddr(i.address ?? meta.deployedAddress); if (addr) ruleMap.set(addr, i); }
      source = { type: 'bundle_deploy_result', bundleDeployHandle: input.bundleDeployHandle };
    } else {
      if (!orchestration) addIssue(validation.errors, 'ORCHESTRATION_INVALID', 'runtime orchestration must be a 20-byte 0x address'); if (!ostcId) addIssue(validation.errors, 'OSTC_ID_MISSING', 'ostcId is required'); source = { type: 'runtime', orchestration: orchestration ?? '', ostcId: ostcId ?? '' };
      if (orchestration && ostcId) { try { structure = parseMaybeJson(await readXrc729OstcJson(orchestration, ostcId)); } catch { addIssue(validation.errors, 'RUNTIME_STRUCTURE_UNAVAILABLE', 'runtime structure cannot be loaded'); } if (!ostcHash) { try { const rows = await listXrc729OstcStateDb(orchestration, false, 1, 25); ostcHash = rows.find((r) => r.ostcId === ostcId)?.ostcHash ?? undefined; } catch {} } }
      if (!ostcHash) addIssue(validation.warnings, 'OSTC_HASH_UNAVAILABLE', 'ostcHash could not be resolved');
    }
    const steps = stepArray(structure); const stepId = typeof input.stepId === 'string' ? input.stepId : inferEntry(steps, validation.warnings); if (!stepId) addIssue(validation.errors, 'STEP_UNRESOLVED', 'step cannot be resolved');
    const selected = Array.isArray(input.sessions) && input.sessions.length ? input.sessions.filter(isPlainRecord) : [{}]; const fallback = { stepId, payload: input.payload, maxTotalGas: input.maxTotalGas, expiry: input.expiry };
    request = { type: 'xdala_session_start', version: 'xgr-session-start@1', handle, ...(isPlainRecord(input.summary) ? { summary: input.summary } : {}), mode: selected.length === 1 ? 'single' : 'queue', sessions: makeSessions(orchestration ?? '', ostcId ?? '', ostcHash, selected, fallback), executorGrants: isPlainRecord(input.executorGrants) ? input.executorGrants : undefined, chain: chainForRequest(input.network, chainExpectation), ...defaultsFor(selected.length, input) };
    for (const session of request.sessions) { const step = steps.find((s) => s.id === session.stepId); if (!step) { addIssue(validation.errors, 'STEP_UNRESOLVED', `step ${session.stepId} cannot be resolved`); continue; } let req: string[] = []; const ref = ruleRefOf(step); if (ref && ruleMap.has(ref)) req = requiredFromRule(ruleMap.get(ref)); else if (ref && ADDRESS_RE.test(ref)) { try { req = requiredFromRule(await readXrc137RuleJson(ref)); } catch {} } validation.requiredPayload = [...new Set([...(validation.requiredPayload ?? []), ...req])].sort(); validation.missingPayload = [...new Set([...(validation.missingPayload ?? []), ...missing(req, session.payload)])].sort(); }
    if ((validation.missingPayload?.length ?? 0) > 0) addIssue(validation.warnings, 'PAYLOAD_FIELDS_MISSING', 'Some required payload fields are missing and can be filled in Workbench.');
    if (orchestration && ostcId) { try { const g = await renderRuntimeMermaid({ xrc729Address: orchestration, ostcId }, { includeRules: false, includePayloadFields: true }); graph = { mermaid: g.mermaid, nodes: g.nodes, edges: g.edges, warnings: g.warnings }; } catch {} }
    const check = validateSessionStartRequest(request); validation.errors.push(...check.errors); validation.warnings.push(...check.warnings); validation.valid = validation.errors.length === 0; authorityOrchestration = orchestration;
  }
  if (containsLeak(request)) throw new Error('request contains a disallowed sensitive field name');
  const signer = normAddr(input.expectedSigner) ?? normAddr(input.walletAddress); let authority: XdalaSessionStartRecord['authority'] = { requiredRole: 'owner_or_executor', authorityStatus: 'not_checked', canStart: false, reason: 'Connect wallet or unlock signer in xDaLa Workbench to verify owner/executor authority before starting.' };
  if (authorityOrchestration) { const resolved = await resolveSessionStartAuthority(authorityOrchestration, signer); authority = resolved.authority; validation.warnings.push(...resolved.warnings); }
  if (!signer && authority.authorityStatus !== 'authority_unavailable') { authority.authorityStatus = 'not_checked'; authority.canStart = false; authority.reason = 'Connect wallet or unlock signer in xDaLa Workbench to verify owner/executor authority before starting.'; }
  const requestedTtl = Number.isSafeInteger(input.ttlSeconds) ? Number(input.ttlSeconds) : env.sessionStart.defaultTtlSeconds; const ttl = Math.max(60, Math.min(requestedTtl, env.sessionStart.maxTtlSeconds));
  const record: XdalaSessionStartRecord = { handle, type: 'xdala_session_start_handoff', version: 'xgr-session-start@1', network: input.network, chainId: chainExpectation.chainId, status: 'pending_import', createdAt, updatedAt: createdAt, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), source, request, authority, validation, graph, events: [{ at: createdAt, type: 'created' }] };
  await save(record); return toPublic(record);
}

export async function getSessionStartHandoff(handle: string, options: { mutateExpired?: boolean } = {}): Promise<PublicSessionStartRecord | null> { const record = await readRecord(handle); if (!record) return null; if (options.mutateExpired === false) return toPublic(isExpired(record) && !terminalStatuses.has(record.status) ? { ...record, status: 'expired' } : record); await enforceTtl(record); return toPublic(record); }
export async function cancelSessionStartHandoff(handle: string): Promise<PublicSessionStartRecord | null> { const record = await readRecord(handle); if (!record) return null; await enforceTtl(record); if (!terminalStatuses.has(record.status)) { record.status = 'cancelled'; record.events.push({ at: now(), type: 'cancelled' }); await save(record); } return toPublic(record); }
function validateResultOriginalRequest(handle: string, value: unknown): string | null {
  if (!isPlainRecord(value)) return 'originalRequest must be an object';
  for (const key of Object.keys(value)) if (!originalRequestKeys.has(key)) return `originalRequest must not include ${key}`;
  if (value.type !== 'xdala_session_start') return 'originalRequest.type must be xdala_session_start';
  if (value.version !== 'xgr-session-start@1') return 'originalRequest.version must be xgr-session-start@1';
  if (value.handle !== handle) return 'originalRequest.handle must match route handle';
  if (value.summary !== undefined && !isPlainRecord(value.summary)) return 'originalRequest.summary must be an object when present';
  if (value.mode !== undefined && value.mode !== 'single' && value.mode !== 'queue') return 'originalRequest.mode must be single or queue';
  if (value.chain !== undefined) {
    if (!isPlainRecord(value.chain)) return 'originalRequest.chain must be an object when present';
    for (const key of Object.keys(value.chain)) if (!originalRequestChainKeys.has(key)) return `originalRequest.chain must not include ${key}`;
  }
  if (!Array.isArray(value.sessions) || value.sessions.length < 1 || value.sessions.length > 100) return 'originalRequest.sessions length must be 1..100';
  for (const [i, session] of value.sessions.entries()) {
    if (!isPlainRecord(session)) return `originalRequest.sessions.${i} must be an object`;
    if ('__uid' in session) return `originalRequest.sessions.${i} must not include __uid`;
    if (typeof session.orchestration !== 'string' || !ADDRESS_RE.test(session.orchestration)) return `originalRequest.sessions.${i}.orchestration must be a 20-byte 0x address`;
    if (typeof session.ostcId !== 'string' || !session.ostcId) return `originalRequest.sessions.${i}.ostcId is required`;
    if (typeof session.stepId !== 'string' || !session.stepId) return `originalRequest.sessions.${i}.stepId is required`;
    if (!isPlainRecord(session.payload)) return `originalRequest.sessions.${i}.payload must be an object`;
    if (!Number.isSafeInteger(session.maxTotalGas) || Number(session.maxTotalGas) < 0) return `originalRequest.sessions.${i}.maxTotalGas must be a non-negative safe integer`;
  }
  return null;
}
export function validateSessionStartResult(handle: string, body: unknown): { ok: true; result: NormalizedSessionStartResult } | { ok: false; statusCode: number; error: string } {
  if (!isPlainRecord(body)) return { ok: false, statusCode: 400, error: 'result body must be an object' };
  for (const key of Object.keys(body)) if (!resultTopLevelKeys.has(key)) return { ok: false, statusCode: 400, error: `result body must not include ${key}` };
  if (body.handle !== handle) return { ok: false, statusCode: 400, error: 'result handle must match route handle' };
  if (body.type !== 'xdala_session_start_result') return { ok: false, statusCode: 400, error: 'result type must be xdala_session_start_result' };
  if (typeof body.status !== 'string' || !resultStatuses.has(body.status)) return { ok: false, statusCode: 400, error: 'invalid terminal session start result status' };
  if (!isIso(body.completedAt)) return { ok: false, statusCode: 400, error: 'completedAt must be a valid ISO-8601 timestamp' };
  if (typeof body.inputType !== 'string' || !resultInputTypes.has(body.inputType)) return { ok: false, statusCode: 400, error: 'inputType must be singleSession or sessionQueue' };
  const originalRequestError = validateResultOriginalRequest(handle, body.originalRequest);
  if (originalRequestError) return { ok: false, statusCode: 400, error: originalRequestError };
  if (!Array.isArray(body.results)) return { ok: false, statusCode: 400, error: 'results must be an array' };
  const requestedSessions = (body.originalRequest as Record<string, unknown>).sessions as unknown[];
  if (body.results.length !== requestedSessions.length) return { ok: false, statusCode: 400, error: 'results must contain exactly one entry per originalRequest session' };
  if (containsCallbackLeak(body)) return { ok: false, statusCode: 400, error: 'result body contains a raw secret or sensitive value; secrets must be redacted to [redacted]' };
  for (const [i, entry] of body.results.entries()) {
    if (!isPlainRecord(entry)) return { ok: false, statusCode: 400, error: `results.${i} must be an object` };
    if (typeof entry.ok !== 'boolean') return { ok: false, statusCode: 400, error: `results.${i}.ok is required and must be boolean` };
    const allowedKeys = entry.ok ? resultEntryKeysOk : resultEntryKeysFail;
    for (const key of Object.keys(entry)) if (!allowedKeys.has(key)) return { ok: false, statusCode: 400, error: `results.${i} must not include ${key}` };
    if (entry.index !== undefined && (!Number.isSafeInteger(entry.index) || Number(entry.index) < 0)) return { ok: false, statusCode: 400, error: `results.${i}.index must be a non-negative integer` };
    if (entry.starter !== undefined && !normAddr(entry.starter)) return { ok: false, statusCode: 400, error: `results.${i}.starter must be an address` };
    if (entry.ok) {
      if (typeof entry.status !== 'string' || !resultEntryStatusOk.has(entry.status)) return { ok: false, statusCode: 400, error: `results.${i}.status must be started when ok=true` };
      if (typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) return { ok: false, statusCode: 400, error: `results.${i} ok=true requires a sessionId string` };
      if (entry.owner !== undefined && !normAddr(entry.owner)) return { ok: false, statusCode: 400, error: `results.${i}.owner must be an address` };
    } else {
      if (typeof entry.status !== 'string' || !resultEntryStatusFail.has(entry.status)) return { ok: false, statusCode: 400, error: `results.${i}.status must be failed, cancelled, or not_started when ok=false` };
      if (typeof entry.stage !== 'string' || !resultEntryStageFail.has(entry.stage)) return { ok: false, statusCode: 400, error: `results.${i}.stage must be start, cancelled, or not_started when ok=false` };
      if (typeof entry.error !== 'string' || entry.error.trim().length === 0) return { ok: false, statusCode: 400, error: `results.${i}.error is required when ok=false` };
    }
  }
  const result: NormalizedSessionStartResult = { handle, type: 'xdala_session_start_result', status: body.status as NormalizedSessionStartResult['status'], completedAt: body.completedAt, receivedAt: now(), inputType: body.inputType as NormalizedSessionStartResult['inputType'], originalRequest: body.originalRequest as Record<string, unknown>, results: body.results as Array<Record<string, unknown>> };
  return { ok: true, result };
}
export async function recordSessionStartResult(handle: string, result: NormalizedSessionStartResult): Promise<PublicSessionStartRecord | { error: string; statusCode: number } | null> { const record = await readRecord(handle); if (!record) return null; await enforceTtl(record); if (record.status === 'expired') return { error: 'session start handoff expired', statusCode: 410 }; if (terminalStatuses.has(record.status) && record.result) { if (deepEqual(record.result, { ...result, receivedAt: record.result.receivedAt })) return toPublic(record); return { error: 'session start result already recorded', statusCode: 409 }; } if (record.status === 'cancelled') return { error: 'session start handoff cancelled', statusCode: 409 }; record.status = result.status; record.result = result; record.events.push({ at: result.receivedAt, type: 'session_start_result_received', completedAt: result.completedAt, inputType: result.inputType, status: result.status, resultCount: result.results.length, okCount: result.results.filter((r) => r.ok === true).length, failedCount: result.results.filter((r) => r.ok === false).length }); await save(record); return toPublic(record); }