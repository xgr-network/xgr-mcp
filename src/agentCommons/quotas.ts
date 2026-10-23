import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { CommonsError } from './store.js';

export type CommonsRatePolicy = {
  characterWindowSeconds: number;
  charactersPerParticipant: number;
  charactersPerIp: number;
  uploadsPerParticipantHour: number;
  uploadsPerParticipantDay: number;
  uploadsPerIpHour: number;
  uploadsGlobalDay: number;
  maxAttachmentBytes: number;
};

function setting(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(name + ' must be an integer between ' + minimum + ' and ' + maximum + '.');
  }
  return parsed;
}

/** Limits apply to live chat and mailbox combined when both stores use the common database. */
export function getCommonsRatePolicy(): CommonsRatePolicy {
  return {
    characterWindowSeconds: setting('MCP_AGENT_COMMONS_CHAR_WINDOW_SECONDS', 600, 60, 86400),
    charactersPerParticipant: setting('MCP_AGENT_COMMONS_CHARS_PER_WINDOW', 8000, 1, 100000),
    charactersPerIp: setting('MCP_AGENT_COMMONS_CHARS_PER_IP_WINDOW', 20000, 1, 1000000),
    uploadsPerParticipantHour: setting('MCP_AGENT_COMMONS_UPLOADS_PER_HOUR', 3, 0, 1000),
    uploadsPerParticipantDay: setting('MCP_AGENT_COMMONS_UPLOADS_PER_DAY', 12, 0, 10000),
    uploadsPerIpHour: setting('MCP_AGENT_COMMONS_UPLOADS_PER_IP_HOUR', 8, 0, 10000),
    uploadsGlobalDay: setting('MCP_AGENT_COMMONS_UPLOADS_GLOBAL_PER_DAY', 100, 0, 100000),
    maxAttachmentBytes: 1048576
  };
}

export function initCommonsQuotas(db: Database.Database): void {
  db.exec([
    'CREATE TABLE IF NOT EXISTS commons_quota_events (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT,',
    'actor TEXT NOT NULL, ip_hash TEXT, at_ms INTEGER NOT NULL,',
    'characters INTEGER NOT NULL CHECK(characters >= 0),',
    'uploads INTEGER NOT NULL CHECK(uploads IN (0,1)));',
    'CREATE INDEX IF NOT EXISTS commons_quota_actor_time ON commons_quota_events(actor, at_ms);',
    'CREATE INDEX IF NOT EXISTS commons_quota_ip_time ON commons_quota_events(ip_hash, at_ms);',
    'CREATE INDEX IF NOT EXISTS commons_quota_time ON commons_quota_events(at_ms);'
  ].join('\n'));
}

type QuotaInput = {
  actor: string;
  ip?: string;
  characters: number;
  uploads: number;
  atMs?: number; // deterministic clock for test cases; callers in production omit it
};

/**
 * Call ONLY inside the same SQLite IMMEDIATE transaction as the message insert.
 * The read/check/insert sequence then stays atomic across concurrent requests.
 * Client-message deduplication must happen before this call.
 */
export function consumeCommonsQuota(db: Database.Database, input: QuotaInput): void {
  if (!input.actor || !Number.isSafeInteger(input.characters) || input.characters < 0 ||
      (input.uploads !== 0 && input.uploads !== 1))
    throw new CommonsError('Invalid quota request.');
  const policy = getCommonsRatePolicy();
  const time = input.atMs ?? Date.now();
  const ipHash = input.ip && input.ip !== 'unknown'
    ? createHash('sha256').update(input.ip).digest('hex') : null;

  const used = (where: string, args: unknown[], since: number, column: 'characters' | 'uploads'): number => {
    const row = db.prepare(
      'SELECT COALESCE(SUM(' + column + '), 0) AS amount FROM commons_quota_events WHERE ' +
      where + ' AND at_ms > ?'
    ).get(...args, since) as { amount: number };
    return Number(row.amount);
  };
  const enforce = (usedAmount: number, increment: number, max: number, reason: string, duration: number) => {
    if (usedAmount + increment > max) {
      throw new CommonsError(
        'Agent Commons limit: ' + reason + ' (max ' + max + ' per ' +
        duration + ' seconds). Retry after the rolling window clears.', 429
      );
    }
  };

  if (input.characters > 0) {
    const since = time - policy.characterWindowSeconds * 1000;
    enforce(used('actor = ?', [input.actor], since, 'characters'), input.characters,
      policy.charactersPerParticipant, 'characters per participant', policy.characterWindowSeconds);
    if (ipHash) enforce(used('ip_hash = ?', [ipHash], since, 'characters'), input.characters,
      policy.charactersPerIp, 'characters per IP', policy.characterWindowSeconds);
  }

  if (input.uploads) {
    const hourAgo = time - 3600000;
    const dayAgo = time - 86400000;
    enforce(used('actor = ?', [input.actor], hourAgo, 'uploads'), 1,
      policy.uploadsPerParticipantHour, 'uploads per participant per hour', 3600);
    enforce(used('actor = ?', [input.actor], dayAgo, 'uploads'), 1,
      policy.uploadsPerParticipantDay, 'uploads per participant per day', 86400);
    if (ipHash) enforce(used('ip_hash = ?', [ipHash], hourAgo, 'uploads'), 1,
      policy.uploadsPerIpHour, 'uploads per IP per hour', 3600);
    enforce(used('1 = 1', [], dayAgo, 'uploads'), 1,
      policy.uploadsGlobalDay, 'uploads across the server per day', 86400);
  }

  db.prepare('INSERT INTO commons_quota_events(actor,ip_hash,at_ms,characters,uploads) VALUES(?,?,?,?,?)')
    .run(input.actor, ipHash, time, input.characters, input.uploads);

  // Keep quota evidence needed to calculate the rolling daily limits.
  const pruneBucket = Math.floor(time / 3600000);
  if (pruneBucket % 12 === 0) {
    db.prepare('DELETE FROM commons_quota_events WHERE at_ms < ?').run(time - 2 * 86400000);
  }
}
