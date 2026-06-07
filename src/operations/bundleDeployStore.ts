import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';

export type BundleDeployStatus = 'pending_import' | 'opened' | 'imported' | 'deployed' | 'failed' | 'cancelled' | 'expired';

export type NormalizedBundleDeployResult = {
  handle: string;
  type: 'xdala_bundle_deploy_result';
  status: 'completed';
  completedAt: string;
  receivedAt: string;
  inputType: string;
  artifact: Record<string, unknown>;
  deployResults: unknown[];
  requestSummary?: Record<string, unknown>;
};

export type BundleDeployRecord = {
  handle: string;
  type: 'xdala_bundle_deploy';
  network: string;
  chainId: number;
  status: BundleDeployStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  summary: Record<string, unknown>;
  validation: Record<string, unknown>;
  bundle: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  result?: NormalizedBundleDeployResult;
  deployedArtifact?: Record<string, unknown>;
};

export type PublicBundleDeployRecord = Pick<
  BundleDeployRecord,
  | 'handle'
  | 'type'
  | 'network'
  | 'chainId'
  | 'status'
  | 'createdAt'
  | 'expiresAt'
  | 'summary'
  | 'validation'
  | 'bundle'
  | 'events'
  | 'result'
  | 'deployedArtifact'
>;

export type BundleDeployCreateResult = {
  handle: string;
  xdalaUrl: string;
  fetchUrl: string;
  expiresAt: string;
  status: BundleDeployStatus;
};

const statusValues = new Set<BundleDeployStatus>(['pending_import', 'opened', 'imported', 'deployed', 'failed', 'cancelled', 'expired']);
const terminalStatuses = new Set<BundleDeployStatus>(['deployed', 'failed', 'cancelled', 'expired']);
const now = () => new Date().toISOString();
const dir = () => resolve(env.bundleDeploy.storeDir);
const clean = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '');
const fileFor = (handle: string) => join(dir(), `${clean(handle)}.json`);

function jsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2
  );
}

async function ensureDir(): Promise<void> {
  if (!existsSync(dir())) await mkdir(dir(), { recursive: true });
}

function isExpired(record: BundleDeployRecord): boolean {
  return Date.now() > Date.parse(record.expiresAt);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!deepEqual(leftKeys, rightKeys)) return false;
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

function isValidIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && !Number.isNaN(new Date(value).getTime());
}

function assertBundleShape(bundle: Record<string, unknown>): void {
  if (bundle.format !== 'xgr-multi-bundle@1') {
    throw new Error('bundle.format must be "xgr-multi-bundle@1"');
  }
  if (!Array.isArray(bundle.bundles)) {
    throw new Error('bundle.bundles must be an array');
  }
}

function toPublic(record: BundleDeployRecord): PublicBundleDeployRecord {
  return {
    handle: record.handle,
    type: record.type,
    network: record.network,
    chainId: record.chainId,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    summary: record.summary,
    validation: record.validation,
    bundle: record.bundle,
    events: record.events,
    result: record.result,
    deployedArtifact: record.deployedArtifact
  };
}

function xdalaUrl(handle: string): string {
  return `${env.bundleDeploy.xdalaBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(handle)}`;
}

function fetchUrl(handle: string): string {
  return `${env.operations.publicBaseUrl.replace(/\/+$/, '')}/api/bundle-deploy/${encodeURIComponent(handle)}`;
}

async function readRecord(handle: string): Promise<BundleDeployRecord | null> {
  await ensureDir();
  const safeHandle = clean(handle);
  if (safeHandle !== handle || !handle.startsWith('bd_') || handle.length < 51) return null;
  const path = fileFor(handle);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8')) as BundleDeployRecord;
}

async function save(record: BundleDeployRecord): Promise<void> {
  await ensureDir();
  record.updatedAt = now();
  await writeFile(fileFor(record.handle), `${jsonStringify(record)}\n`, 'utf8');
}

async function enforceTtl(record: BundleDeployRecord): Promise<BundleDeployRecord> {
  if (isExpired(record) && !terminalStatuses.has(record.status)) {
    record.status = 'expired';
    record.events.push({ at: now(), type: 'expired' });
    await save(record);
  }
  return record;
}

export function isBundleDeployStatus(value: unknown): value is BundleDeployStatus {
  return typeof value === 'string' && statusValues.has(value as BundleDeployStatus);
}

export function bundleDeployLinks(handle: string): Pick<BundleDeployCreateResult, 'xdalaUrl' | 'fetchUrl'> {
  return { xdalaUrl: xdalaUrl(handle), fetchUrl: fetchUrl(handle) };
}

export function validateBundleDeployResult(handle: string, body: unknown):
  | { ok: true; result: NormalizedBundleDeployResult }
  | { ok: false; statusCode: number; error: string; details?: unknown } {
  if (!isPlainRecord(body)) {
    return { ok: false, statusCode: 400, error: 'bundle deploy result body must be an object' };
  }
  if (body.handle !== handle) {
    return { ok: false, statusCode: 400, error: 'bundle deploy result handle must match route handle' };
  }
  if (body.type !== 'xdala_bundle_deploy_result') {
    return { ok: false, statusCode: 400, error: 'bundle deploy result type must be xdala_bundle_deploy_result' };
  }
  if (body.status !== 'completed') {
    return { ok: false, statusCode: 400, error: 'bundle deploy result status must be completed' };
  }
  if (typeof body.completedAt !== 'string' || !isValidIsoTimestamp(body.completedAt)) {
    return { ok: false, statusCode: 400, error: 'bundle deploy result completedAt must be a valid ISO-8601 timestamp' };
  }
  if (typeof body.inputType !== 'string' || body.inputType.trim().length === 0) {
    return { ok: false, statusCode: 400, error: 'bundle deploy result inputType must be a non-empty string' };
  }
  if (!isPlainRecord(body.artifact)) {
    return { ok: false, statusCode: 400, error: 'bundle deploy result artifact must be a non-null object' };
  }
  if (!Array.isArray(body.deployResults)) {
    return { ok: false, statusCode: 400, error: 'bundle deploy result deployResults must be an array' };
  }
  if (body.requestSummary !== undefined && !isPlainRecord(body.requestSummary)) {
    return { ok: false, statusCode: 400, error: 'bundle deploy result requestSummary must be an object when present' };
  }

  const result: NormalizedBundleDeployResult = {
    handle,
    type: 'xdala_bundle_deploy_result',
    status: 'completed',
    completedAt: body.completedAt,
    receivedAt: now(),
    inputType: body.inputType.trim(),
    artifact: body.artifact,
    deployResults: body.deployResults
  };
  if (body.requestSummary !== undefined) result.requestSummary = body.requestSummary;
  return { ok: true, result };
}

export async function createBundleDeployHandoff(input: {
  network: string;
  chainId: number;
  bundle: Record<string, unknown>;
  summary?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<BundleDeployCreateResult> {
  assertBundleShape(input.bundle);

  const handle = `bd_${randomBytes(24).toString('hex')}`;
  const createdAt = now();
  const requestedTtl = input.ttlSeconds ?? env.bundleDeploy.defaultTtlSeconds;
  const ttl = Math.max(60, Math.min(requestedTtl, env.bundleDeploy.maxTtlSeconds));
  const record: BundleDeployRecord = {
    handle,
    type: 'xdala_bundle_deploy',
    network: input.network,
    chainId: input.chainId,
    status: 'pending_import',
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    summary: input.summary || {},
    validation: input.validation || {},
    bundle: input.bundle,
    events: [{ at: createdAt, type: 'created' }]
  };

  await save(record);
  return {
    handle,
    ...bundleDeployLinks(handle),
    expiresAt: record.expiresAt,
    status: record.status
  };
}

export async function getBundleDeployHandoff(handle: string, options: { mutateExpired?: boolean } = {}): Promise<PublicBundleDeployRecord | null> {
  const record = await readRecord(handle);
  if (!record) return null;
  if (options.mutateExpired === false) {
    return toPublic(isExpired(record) && !terminalStatuses.has(record.status) ? { ...record, status: 'expired' } : record);
  }
  await enforceTtl(record);
  return toPublic(record);
}

export async function updateBundleDeployHandoff(input: {
  handle: string;
  status: BundleDeployStatus;
  txHashes?: unknown;
  contracts?: unknown;
  error?: string;
}): Promise<PublicBundleDeployRecord | null> {
  const record = await readRecord(input.handle);
  if (!record) return null;
  await enforceTtl(record);
  if (terminalStatuses.has(record.status)) return toPublic(record);

  record.status = input.status;
  record.events.push({
    at: now(),
    type: input.status,
    txHashes: input.txHashes,
    contracts: input.contracts,
    error: input.error
  });
  await save(record);
  return toPublic(record);
}

export async function cancelBundleDeployHandoff(handle: string): Promise<PublicBundleDeployRecord | null> {
  const record = await readRecord(handle);
  if (!record) return null;
  await enforceTtl(record);
  if (record.status === 'pending_import' || record.status === 'opened') {
    record.status = 'cancelled';
    record.events.push({ at: now(), type: 'cancelled' });
    await save(record);
  }
  return toPublic(record);
}

export async function recordBundleDeployResult(input: {
  handle: string;
  result: NormalizedBundleDeployResult;
}): Promise<PublicBundleDeployRecord | { error: string; statusCode: number } | null> {
  const record = await readRecord(input.handle);
  if (!record) return null;
  await enforceTtl(record);

  if (record.status === 'expired') return { error: 'bundle deploy handoff expired', statusCode: 410 };
  if (record.status === 'cancelled') return { error: 'bundle deploy handoff cancelled', statusCode: 409 };
  if (record.status === 'failed') return { error: 'bundle deploy handoff failed', statusCode: 409 };

  if (record.status === 'deployed' && record.result) {
    const existing = record.result;
    const repeated = existing.handle === input.result.handle
      && existing.type === input.result.type
      && existing.status === input.result.status
      && existing.completedAt === input.result.completedAt
      && existing.inputType === input.result.inputType
      && deepEqual(existing.artifact, input.result.artifact)
      && deepEqual(existing.deployResults, input.result.deployResults)
      && deepEqual(existing.requestSummary, input.result.requestSummary);
    if (repeated) return toPublic(record);
    return { error: 'bundle deploy result already recorded', statusCode: 409 };
  }

  record.status = 'deployed';
  record.result = input.result;
  record.deployedArtifact = input.result.artifact;
  record.events.push({
    at: input.result.receivedAt,
    type: 'result_received',
    completedAt: input.result.completedAt,
    inputType: input.result.inputType,
    deployResultsCount: input.result.deployResults.length
  });
  await save(record);
  return toPublic(record);
}
