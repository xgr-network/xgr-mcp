import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type StarterGasGrantStatus = 'reserved' | 'broadcast' | 'confirmed' | 'failed';

export type StarterGasGrant = {
  address: string;
  status: StarterGasGrantStatus;
  txHash?: string;
  amountXgr: number;
  purpose?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  error?: string;
  attemptCount: number;
};

type LegacyGrant = {
  address?: unknown;
  txHash?: unknown;
  amountXgr?: unknown;
  createdAt?: unknown;
  purpose?: unknown;
};

type LegacyStore = { grants?: LegacyGrant[] };

type Row = {
  address: string;
  status: StarterGasGrantStatus;
  tx_hash: string | null;
  amount_xgr: number;
  purpose: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  error: string | null;
  attempt_count: number;
};

export type ReserveGrantInput = {
  address: string;
  amountXgr: number;
  purpose?: string;
  maxHourlyGrants: number;
  maxDailyGrants: number;
  maxAttemptsPerAddress: number;
  reservationTimeoutSeconds: number;
};

function mapRow(row: Row | undefined): StarterGasGrant | undefined {
  if (!row) return undefined;
  return {
    address: row.address,
    status: row.status,
    txHash: row.tx_hash ?? undefined,
    amountXgr: row.amount_xgr,
    purpose: row.purpose ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at ?? undefined,
    error: row.error ?? undefined,
    attemptCount: row.attempt_count
  };
}

export class StarterGasStore {
  private readonly db: Database.Database;

  constructor(dbPath: string, legacyStorePath?: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS starter_gas_grants (
        address TEXT PRIMARY KEY COLLATE NOCASE,
        status TEXT NOT NULL CHECK (status IN ('reserved','broadcast','confirmed','failed')),
        tx_hash TEXT UNIQUE,
        amount_xgr REAL NOT NULL,
        purpose TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT,
        error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_starter_gas_status_created
        ON starter_gas_grants(status, created_at);
    `);
    this.importLegacyJson(legacyStorePath);
  }

  close(): void {
    this.db.close();
  }

  get(address: string): StarterGasGrant | undefined {
    const row = this.db.prepare('SELECT * FROM starter_gas_grants WHERE address = ?').get(address) as Row | undefined;
    return mapRow(row);
  }

  reserve(input: ReserveGrantInput): StarterGasGrant {
    const transaction = this.db.transaction(() => {
      const now = new Date();
      const nowIso = now.toISOString();
      const staleBefore = new Date(now.getTime() - input.reservationTimeoutSeconds * 1000).toISOString();
      this.db.prepare(`
        UPDATE starter_gas_grants
        SET status = 'failed', error = 'stale reservation expired before broadcast', updated_at = ?
        WHERE status = 'reserved' AND updated_at < ?
      `).run(nowIso, staleBefore);

      const existing = this.get(input.address);
      if (existing) {
        if (existing.status === 'confirmed') throw new Error('This address has already received an XGR starter-gas grant.');
        if (existing.status === 'broadcast') throw new Error('A starter-gas transaction for this address has already been broadcast and is awaiting confirmation.');
        if (existing.status === 'reserved') throw new Error('A starter-gas request for this address is already being processed.');
        if (existing.attemptCount >= input.maxAttemptsPerAddress) throw new Error('This address has reached the maximum number of starter-gas attempts.');
      }

      const hourStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const dayStart = `${nowIso.slice(0, 10)}T00:00:00.000Z`;
      const activeStatuses = "('reserved','broadcast','confirmed')";
      const hourly = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM starter_gas_grants WHERE status IN ${activeStatuses} AND created_at >= ?`).get(hourStart) as { count: number }).count);
      const daily = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM starter_gas_grants WHERE status IN ${activeStatuses} AND created_at >= ?`).get(dayStart) as { count: number }).count);
      if (hourly >= input.maxHourlyGrants) throw new Error('The hourly XGR starter-gas grant limit has been reached.');
      if (daily >= input.maxDailyGrants) throw new Error('The daily XGR starter-gas grant limit has been reached.');

      if (existing) {
        this.db.prepare(`
          UPDATE starter_gas_grants
          SET status = 'reserved', tx_hash = NULL, amount_xgr = ?, purpose = ?, created_at = ?, updated_at = ?, confirmed_at = NULL, error = NULL, attempt_count = attempt_count + 1
          WHERE address = ?
        `).run(input.amountXgr, input.purpose ?? null, nowIso, nowIso, input.address);
      } else {
        this.db.prepare(`
          INSERT INTO starter_gas_grants(address, status, amount_xgr, purpose, created_at, updated_at, attempt_count)
          VALUES (?, 'reserved', ?, ?, ?, ?, 1)
        `).run(input.address, input.amountXgr, input.purpose ?? null, nowIso, nowIso);
      }

      return this.get(input.address)!;
    });

    return transaction.immediate();
  }

  markBroadcast(address: string, txHash: string): StarterGasGrant {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE starter_gas_grants
      SET status = 'broadcast', tx_hash = ?, updated_at = ?, error = NULL
      WHERE address = ? AND status = 'reserved'
    `).run(txHash, now, address);
    return this.get(address)!;
  }

  markConfirmed(address: string): StarterGasGrant {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE starter_gas_grants
      SET status = 'confirmed', confirmed_at = ?, updated_at = ?, error = NULL
      WHERE address = ? AND status IN ('reserved','broadcast')
    `).run(now, now, address);
    return this.get(address)!;
  }

  markFailed(address: string, error: string): StarterGasGrant | undefined {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE starter_gas_grants
      SET status = 'failed', updated_at = ?, error = ?
      WHERE address = ? AND status IN ('reserved','broadcast')
    `).run(now, error.slice(0, 1000), address);
    return this.get(address);
  }

  private importLegacyJson(legacyStorePath?: string): void {
    if (!legacyStorePath || !existsSync(legacyStorePath)) return;
    const alreadyImported = Number((this.db.prepare('SELECT COUNT(*) AS count FROM starter_gas_grants').get() as { count: number }).count) > 0;
    if (alreadyImported) return;

    const parsed = JSON.parse(readFileSync(legacyStorePath, 'utf8')) as LegacyStore;
    const grants = Array.isArray(parsed.grants) ? parsed.grants : [];
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO starter_gas_grants(address, status, tx_hash, amount_xgr, purpose, created_at, updated_at, confirmed_at, attempt_count)
      VALUES (?, 'confirmed', ?, ?, ?, ?, ?, ?, 1)
    `);
    const transaction = this.db.transaction(() => {
      for (const grant of grants) {
        if (typeof grant.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(grant.address)) continue;
        if (typeof grant.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(grant.txHash)) continue;
        const createdAt = typeof grant.createdAt === 'string' && !Number.isNaN(Date.parse(grant.createdAt))
          ? new Date(grant.createdAt).toISOString()
          : new Date().toISOString();
        insert.run(
          grant.address,
          grant.txHash,
          typeof grant.amountXgr === 'number' ? grant.amountXgr : 1,
          typeof grant.purpose === 'string' ? grant.purpose : null,
          createdAt,
          createdAt,
          createdAt
        );
      }
    });
    transaction.immediate();
  }
}
