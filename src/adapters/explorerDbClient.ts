import { Pool, type QueryResult } from 'pg';
import { env } from '../config/env.js';

let pool: Pool | undefined;

export function hasExplorerDbConfig(): boolean {
  return Boolean(env.pgro.host && env.pgro.user && env.pgro.database);
}

function requireExplorerDbConfig(): void {
  const missing: string[] = [];
  if (!env.pgro.host) missing.push('PGRO_HOST');
  if (!env.pgro.user) missing.push('PGRO_USER');
  if (!env.pgro.database) missing.push('PGRO_DB');

  if (missing.length > 0) {
    throw new Error(`Explorer read-only database is not configured; missing ${missing.join(', ')}`);
  }
}

function getPool(): Pool {
  requireExplorerDbConfig();

  if (!pool) {
    pool = new Pool({
      host: env.pgro.host,
      port: env.pgro.port,
      user: env.pgro.user,
      password: env.pgro.password,
      database: env.pgro.database,
      max: env.pgro.poolMax,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 2_000,
      statement_timeout: env.pgro.statementTimeoutMs
    });
  }

  return pool;
}

export async function explorerDbQuery<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params);
}
