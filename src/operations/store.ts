import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';

export type OperationStatus = 'pending_user_action' | 'opened' | 'wallet_connected' | 'tx_requested' | 'tx_submitted' | 'completed' | 'failed' | 'cancelled' | 'expired';
export type StepStatus = 'pending' | 'requested' | 'submitted' | 'confirmed' | 'failed' | 'skipped';

export type OperationStep = {
  id: string;
  kind: string;
  label: string;
  status: StepStatus;
  txRequest?: Record<string, unknown>;
  txHash?: string;
  error?: string;
  result?: unknown;
};

export type OperationRecord = {
  id: string;
  secretHash: string;
  type: string;
  network: string;
  chainId: number;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  summary: Record<string, unknown>;
  payload: unknown;
  validation?: unknown;
  policy: Record<string, unknown>;
  steps: OperationStep[];
  events: Array<Record<string, unknown>>;
};

export type PublicOperation = Omit<OperationRecord, 'secretHash'> & { operationUrl?: string };
export type OperationMetadata = Pick<OperationRecord, 'id' | 'type' | 'network' | 'chainId' | 'status' | 'createdAt' | 'updatedAt' | 'expiresAt' | 'summary' | 'policy'> & {
  steps: Array<Pick<OperationStep, 'id' | 'kind' | 'label' | 'status' | 'txHash' | 'error'>>;
};

const terminalStatuses = new Set<OperationStatus>(['completed', 'cancelled', 'expired']);
const now = () => new Date().toISOString();
const dir = () => resolve(env.operations.storeDir);
const clean = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '');
const fileFor = (id: string) => join(dir(), `${clean(id)}.json`);
const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');

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

function operationUrl(record: OperationRecord, secret: string): string {
  return `${env.operations.publicBaseUrl.replace(/\/+$/, '')}/operations/${encodeURIComponent(record.id)}?k=${encodeURIComponent(secret)}`;
}

function toPublic(record: OperationRecord, secret?: string): PublicOperation {
  const { secretHash: _secretHash, ...rest } = record;
  return secret ? { ...rest, operationUrl: operationUrl(record, secret) } : rest;
}

function toMetadata(record: OperationRecord): OperationMetadata {
  return {
    id: record.id,
    type: record.type,
    network: record.network,
    chainId: record.chainId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    summary: record.summary,
    policy: record.policy,
    steps: record.steps.map(({ id, kind, label, status, txHash, error }) => ({ id, kind, label, status, txHash, error }))
  };
}

function isExpired(record: OperationRecord): boolean {
  return Date.now() > Date.parse(record.expiresAt);
}

async function readRecord(id: string): Promise<OperationRecord | null> {
  await ensureDir();
  const safeId = clean(id);
  if (safeId !== id || safeId.length === 0) return null;
  const path = fileFor(id);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8')) as OperationRecord;
}

async function save(record: OperationRecord): Promise<void> {
  await ensureDir();
  record.updatedAt = now();
  await writeFile(fileFor(record.id), `${jsonStringify(record)}\n`, 'utf8');
}

async function enforceTtl(record: OperationRecord): Promise<OperationRecord> {
  if (isExpired(record) && !terminalStatuses.has(record.status)) {
    record.status = 'expired';
    record.events.push({ at: now(), type: 'expired' });
    await save(record);
  }
  return record;
}

export async function createOperation(input: {
  type: string;
  network: string;
  chainId: number;
  summary?: Record<string, unknown>;
  payload?: unknown;
  validation?: unknown;
  policy?: Record<string, unknown>;
  steps?: Array<{ id?: string; kind?: string; label?: string; txRequest?: Record<string, unknown> }>;
  ttlSeconds?: number;
}): Promise<{ operation: PublicOperation; secret: string }> {
  const id = `op_${randomBytes(16).toString('hex')}`;
  const secret = randomBytes(32).toString('base64url');
  const createdAt = now();
  const requestedTtl = input.ttlSeconds ?? env.operations.defaultTtlSeconds;
  const ttl = Math.max(60, Math.min(requestedTtl, env.operations.maxTtlSeconds));
  const record: OperationRecord = {
    id,
    secretHash: hashSecret(secret),
    type: input.type,
    network: input.network,
    chainId: input.chainId,
    status: 'pending_user_action',
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    summary: input.summary || {},
    payload: input.payload ?? null,
    validation: input.validation,
    policy: { ...(input.policy || {}), requiresUserSignature: true, serverMaySign: false, serverMaySubmit: false },
    steps: (input.steps || []).map((s, i) => ({
      id: s.id || `step_${i + 1}`,
      kind: s.kind || 'transaction',
      label: s.label || `Step ${i + 1}`,
      status: 'pending',
      txRequest: s.txRequest
    })),
    events: [{ at: createdAt, type: 'created' }]
  };
  await save(record);
  return { operation: toPublic(record, secret), secret };
}

export async function getOperation(id: string, secret?: string): Promise<PublicOperation | OperationMetadata | null> {
  const record = await readRecord(id);
  if (!record) return null;
  await enforceTtl(record);
  if (!secret) return toMetadata(record);
  if (record.secretHash !== hashSecret(secret)) return null;
  return toPublic(record, secret);
}

export async function updateOperation(input: { id: string; secret: string; status?: OperationStatus; stepId?: string; stepStatus?: StepStatus; txHash?: string; error?: string; result?: unknown }): Promise<PublicOperation | null> {
  if (!input.secret) return null;
  const record = await readRecord(input.id);
  if (!record || record.secretHash !== hashSecret(input.secret)) return null;
  await enforceTtl(record);
  if (terminalStatuses.has(record.status)) return toPublic(record, input.secret);

  if (input.status) record.status = input.status;
  if (input.stepId) {
    const step = record.steps.find((s) => s.id === input.stepId);
    if (step) {
      if (input.stepStatus) step.status = input.stepStatus;
      if (input.txHash) step.txHash = input.txHash;
      if (input.error) step.error = input.error;
      if (input.result !== undefined) step.result = input.result;
    }
  }
  record.events.push({ at: now(), type: input.status || input.stepStatus || 'updated', stepId: input.stepId, txHash: input.txHash, error: input.error });
  await save(record);
  return toPublic(record, input.secret);
}

export async function cancelOperation(id: string, secret: string): Promise<PublicOperation | null> {
  if (!secret) return null;
  const record = await readRecord(id);
  if (!record || record.secretHash !== hashSecret(secret)) return null;
  await enforceTtl(record);
  if (record.status !== 'completed' && record.status !== 'expired') {
    record.status = 'cancelled';
    record.events.push({ at: now(), type: 'cancelled' });
    await save(record);
  }
  return toPublic(record, secret);
}

export async function listOperations(limit = 20): Promise<OperationMetadata[]> {
  await ensureDir();
  const files = (await readdir(dir())).filter((f) => f.endsWith('.json')).slice(0, 200);
  const records = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir(), f), 'utf8')) as OperationRecord));
  for (const record of records) {
    await enforceTtl(record);
  }
  return records
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map((r) => toMetadata(r));
}
