import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { env } from '../config/env.js';

const JSON_TYPES = ['application/json', 'application/*+json'];
const REDACTED = '[REDACTED]';
const secretKeyRe = /^__secret[0-9]*$/;
const sensitiveKeyRe = /^(privateKey|private_key|mnemonic|seedPhrase|signature|permit|walletSecret)$/;

export type PublicHandoffRoute =
  | '/api/session-start/:handle'
  | '/api/session-start/:handle/result'
  | '/api/bundle-deploy/:handle'
  | '/api/bundle-deploy/:handle/status'
  | '/api/bundle-deploy/:handle/result';

export const SESSION_START_HANDLE_RE = /^ss_[A-Za-z0-9_-]{48,125}$/;
export const BUNDLE_DEPLOY_HANDLE_RE = /^bd_[A-Za-z0-9_-]{48,125}$/;

function isSensitiveKey(key: string): boolean {
  return secretKeyRe.test(key) || sensitiveKeyRe.test(key);
}

export function containsSensitiveField(value: unknown): boolean {
  const visit = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.some(visit);
    if (item && typeof item === 'object') {
      return Object.entries(item).some(([key, nested]) => isSensitiveKey(key) || visit(nested));
    }
    return false;
  };
  return visit(value);
}

export function redactSecrets<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item).map(([key, nested]) => [key, isSensitiveKey(key) ? REDACTED : visit(nested)])
      );
    }
    return item;
  };
  return visit(value) as T;
}

export function publicJsonRaw(res: Response, body: unknown, statusCode?: number): void {
  if (statusCode) res.status(statusCode);
  res.json(body);
}

export function publicJsonRedacted(res: Response, body: unknown, statusCode?: number): void {
  if (statusCode) res.status(statusCode);
  res.json(redactSecrets(body));
}

export function publicError(res: Response, statusCode: number, error: string, message?: string): void {
  res.locals.publicHandoffError = message ?? error;
  publicJsonRedacted(res, { error, ...(message ? { message } : {}) }, statusCode);
}

function routeFromRequest(req: Request): PublicHandoffRoute | undefined {
  const base = req.path
    .replace(/^\/api\/session-start\/[^/]+/, '/api/session-start/:handle')
    .replace(/^\/api\/bundle-deploy\/[^/]+/, '/api/bundle-deploy/:handle');
  if (base === '/api/session-start/:handle') return base;
  if (base === '/api/session-start/:handle/result') return base;
  if (base === '/api/bundle-deploy/:handle') return base;
  if (base === '/api/bundle-deploy/:handle/status') return base;
  if (base === '/api/bundle-deploy/:handle/result') return base;
  return undefined;
}

function handoffIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0]?.trim() || req.ip || '';
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0].split(',')[0]?.trim() || req.ip || '';
  return req.ip || req.socket.remoteAddress || '';
}

function hashHandle(handle: string): string {
  return `sha256:${createHash('sha256').update(handle).digest('hex')}`;
}

async function writeAudit(event: Record<string, unknown>): Promise<void> {
  if (!env.publicHandoff.audit.enabled) return;
  const logPath = env.publicHandoff.audit.logPath;
  try {
    const dir = dirname(logPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await appendFile(logPath, `${JSON.stringify(redactSecrets(event))}\n`, 'utf8');
  } catch (error) {
    console.warn('public handoff audit write failed', error instanceof Error ? error.message : String(error));
  }
}

export function publicHandoffAudit(route: PublicHandoffRoute) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on('finish', () => {
      const outcome = res.statusCode === 429 ? 'rate_limited' : res.statusCode >= 400 ? 'error' : 'ok';
      const handle = req.params.handle || '';
      void writeAudit({
        at: new Date().toISOString(),
        kind: 'public_handoff_http',
        route,
        method: req.method,
        handlePrefix: handle.startsWith('ss_') ? 'ss' : handle.startsWith('bd_') ? 'bd' : undefined,
        handleHash: handle ? hashHandle(handle) : undefined,
        ip: handoffIp(req),
        origin: req.headers.origin,
        userAgent: req.headers['user-agent'],
        statusCode: res.statusCode,
        outcome,
        error: res.locals.publicHandoffError,
        durationMs: Date.now() - start
      });
    });
    next();
  };
}

function countAndPrune(bucket: number[], nowMs: number): number {
  const cutoff = nowMs - 60_000;
  while (bucket[0] !== undefined && bucket[0] <= cutoff) bucket.shift();
  return bucket.length;
}

const rateBuckets = new Map<string, number[]>();

function checkLimit(key: string, limit: number, nowMs: number): boolean {
  if (limit <= 0) return false;
  const bucket = rateBuckets.get(key) ?? [];
  countAndPrune(bucket, nowMs);
  if (bucket.length >= limit) {
    rateBuckets.set(key, bucket);
    return false;
  }
  bucket.push(nowMs);
  rateBuckets.set(key, bucket);
  return true;
}

export function publicHandoffIpRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!env.publicHandoff.rateLimit.enabled) return next();
  const ip = handoffIp(req) || 'unknown';
  if (!checkLimit(`ip:${ip}`, env.publicHandoff.rateLimit.perIpPerMinute, Date.now())) {
    res.locals.publicHandoffError = 'rate limited';
    return publicError(res, 429, 'rate limited');
  }
  next();
}

export function publicHandoffHandleRateLimit(kind: 'get' | 'status' | 'result') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!env.publicHandoff.rateLimit.enabled) return next();
    const handle = req.params.handle || '';
    const nowMs = Date.now();
    const checks: Array<[string, number]> = [[`handle:${handle}`, env.publicHandoff.rateLimit.perHandlePerMinute]];
    if (req.method === 'POST') checks.push([`post:${handle}`, env.publicHandoff.rateLimit.postPerHandlePerMinute]);
    if (kind === 'result') checks.push([`result:${handle}`, env.publicHandoff.rateLimit.resultPerHandlePerMinute]);
    if (checks.some(([key, limit]) => !checkLimit(key, limit, nowMs))) {
      res.locals.publicHandoffError = 'rate limited';
      return publicError(res, 429, 'rate limited');
    }
    next();
  };
}

export function publicHandoffAcceptGuard(req: Request, res: Response, next: NextFunction): void {
  const accept = req.headers.accept;
  if (accept && !req.accepts('json')) {
    res.locals.publicHandoffError = 'not acceptable';
    return publicError(res, 406, 'not acceptable');
  }
  next();
}

export function publicHandoffOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowed = env.publicHandoff.allowedOrigins;
  if (origin && allowed.length > 0 && !allowed.includes(origin)) {
    res.locals.publicHandoffError = 'origin not allowed';
    return publicError(res, 403, 'forbidden');
  }
  next();
}

export function publicHandoffHandleGuard(kind: 'session-start' | 'bundle-deploy') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const valid = kind === 'session-start' ? SESSION_START_HANDLE_RE.test(req.params.handle) : BUNDLE_DEPLOY_HANDLE_RE.test(req.params.handle);
    if (!valid) {
      res.locals.publicHandoffError = 'not found';
      return publicError(res, 404, 'not found');
    }
    next();
  };
}

export function publicHandoffJsonContentTypeGuard(req: Request, res: Response, next: NextFunction): void {
  if (!req.is(JSON_TYPES)) {
    res.locals.publicHandoffError = 'unsupported media type';
    return publicError(res, 415, 'unsupported media type');
  }
  next();
}

export const publicHandoffJsonParser = express.json({
  limit: env.publicHandoff.maxBodyBytes,
  type: JSON_TYPES
});

export function publicHandoffMethodNotAllowed(allowed: string[]) {
  return (req: Request, res: Response): void => {
    res.setHeader('Allow', allowed.join(', '));
    res.locals.publicHandoffError = 'method not allowed';
    publicError(res, 405, 'method not allowed');
  };
}

export function publicHandoffErrorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(error);
  if (!routeFromRequest(req)) return next(error);
  const err = error as { type?: string; status?: number; statusCode?: number; message?: string };
  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    res.locals.publicHandoffError = 'payload too large';
    return publicError(res, 413, 'payload too large');
  }
  if (err.type === 'entity.parse.failed' || err.status === 400 || err.statusCode === 400) {
    res.locals.publicHandoffError = 'bad request';
    return publicError(res, 400, 'bad request', 'invalid json');
  }
  res.locals.publicHandoffError = 'bad request';
  return publicError(res, 400, 'bad request');
}
