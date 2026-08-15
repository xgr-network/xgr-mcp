import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { explorerDbQuery } from '../adapters/explorerDbClient.js';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const windowHoursSchema = z.number().int().min(0).max(8760).optional();
const limitSchema = z.number().int().min(1).max(100).optional();

type StartPayloadRow = {
  owner: string | null;
  session_id: string | null;
  tx_hash: string | null;
  block_number: string | number | null;
  payload: unknown;
  seen_at: Date | string | null;
};

type ValueStat = {
  value: string;
  uses: number;
  lastSeenAt: string | null;
};

function textJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function parsePayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function scalarValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function iso(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

function aggregateFieldValues(rows: StartPayloadRow[]): Record<string, ValueStat[]> {
  const byField = new Map<string, Map<string, ValueStat>>();
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!payload) continue;
    const seenAt = iso(row.seen_at);
    for (const [name, raw] of Object.entries(payload)) {
      if (name.startsWith('__')) continue;
      const value = scalarValue(raw);
      if (value === null) continue;
      const values = byField.get(name) ?? new Map<string, ValueStat>();
      const current = values.get(value);
      if (current) current.uses += 1;
      else values.set(value, { value, uses: 1, lastSeenAt: seenAt });
      byField.set(name, values);
    }
  }

  return Object.fromEntries([...byField.entries()].map(([name, values]) => [
    name,
    [...values.values()].sort((a, b) => b.uses - a.uses || String(b.lastSeenAt ?? '').localeCompare(String(a.lastSeenAt ?? ''))).slice(0, 12)
  ]));
}

export function registerSessionPayloadHistoryTools(server: McpServer): void {
  server.registerTool('get_xdala_start_payload_history', {
    title: 'Get XDaLa start payload history',
    description: 'Read-only indexed history of payload values used when starting a specific XRC-729 OSTC entry step. Reads Explorer PGRO through the MCP gateway only, selects the first matching entry-step receipt per owner/session, and returns compact scalar value statistics for UI pickers.',
    inputSchema: {
      xrc729Address: addressSchema,
      ostcId: z.string().min(1),
      stepId: z.string().min(1),
      owner: addressSchema.optional(),
      windowHours: windowHoursSchema,
      limit: limitSchema
    }
  }, async ({ xrc729Address, ostcId, stepId, owner, windowHours = 0, limit = 25 }) => {
    const params: unknown[] = [ostcId, stepId, `%${xrc729Address.toLowerCase()}%`];
    const where = [
      'engine_ostc_id = $1',
      'engine_step_id = $2',
      'LOWER(engine_orchestration::text) LIKE $3',
      'engine_payload IS NOT NULL'
    ];
    if (owner) {
      params.push(owner.toLowerCase());
      where.push(`LOWER(receipt_from_address) = $${params.length}`);
    }
    if (windowHours > 0) {
      params.push(windowHours);
      where.push(`updated_at >= NOW() - ($${params.length}::int * INTERVAL '1 hour')`);
    }
    params.push(limit);

    const result = await explorerDbQuery<StartPayloadRow>(
      `
        WITH ranked AS (
          SELECT receipt_from_address AS owner,
            engine_session_id AS session_id,
            tx_hash,
            block_number,
            engine_payload AS payload,
            updated_at AS seen_at,
            ROW_NUMBER() OVER (
              PARTITION BY receipt_from_address, engine_session_id
              ORDER BY block_number ASC NULLS LAST, updated_at ASC NULLS LAST, tx_hash ASC
            ) AS rn
          FROM tx_receipts
          WHERE ${where.join(' AND ')}
        )
        SELECT owner, session_id, tx_hash, block_number, payload, seen_at
        FROM ranked
        WHERE rn = 1
        ORDER BY seen_at DESC NULLS LAST, block_number DESC NULLS LAST
        LIMIT $${params.length}
      `,
      params
    );

    return textJson({
      source: 'explorer_db',
      xrc729Address: xrc729Address.toLowerCase(),
      ostcId,
      stepId,
      owner: owner?.toLowerCase() ?? null,
      sampledSessions: result.rows.length,
      valuesByField: aggregateFieldValues(result.rows)
    });
  });
}
