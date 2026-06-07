import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  findRecentXdalaSessions,
  getLatestXdalaSessionPayload,
  getXdalaSessionDetail,
  listXdalaSessionIds,
  listXdalaSessionOwners,
  listXdalaSessions,
  getXdalaActiveSessionsTimeseries,
  getXdalaSessionStats,
  getXdalaSessionTimeseries,
  getXdalaStepStats,
  getXdalaPayloadKeyStats,
  getXdalaPayloadTermStats,
  getXdalaPayloadFieldValueStats
} from '../adapters/sessionResolverDb.js';

const ownerSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const windowHoursSchema = z.number().int().min(0).max(8760).optional();
const includePayloadSchema = z.boolean().optional();
const sessionTimeseriesBucketSchema = z.enum(['hour', 'day', 'month']).optional();
const stepStatsBucketSchema = z.enum(['none', 'hour', 'day', 'month']).optional();
const sessionOutcomeSchema = z.enum(['any', 'success', 'fail', 'unknown']).optional();
const payloadSourceSchema = z.enum(['payload', 'apiSaves', 'contractSaves', 'extras']).optional();
const payloadTermModeSchema = z.enum(['keys', 'values', 'keys_and_values']).optional();
const sessionCursorSchema = z.object({
  lastSeenAt: z.string().min(1),
  owner: ownerSchema,
  sessionId: z.string().min(1)
}).optional();

export function registerSessionResolverTools(server: McpServer): void {
  server.registerTool(
    'find_latest_xdala_session',
    {
      title: 'Find latest XDaLa session',
      description: 'Use this when the user asks for the latest XDaLa session but does not provide owner and sessionId. This read-only tool resolves the newest indexed XDaLa session from the Explorer database and can optionally include final receipt payload data.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        includePayload: includePayloadSchema
      }
    },
    async ({ owner, windowHours, includePayload = false }) => {
      const sessions = await findRecentXdalaSessions({ owner, windowHours, includePayload, limit: 1 });
      return { content: [{ type: 'text', text: JSON.stringify(sessions[0] ?? null, null, 2) }] };
    }
  );

  server.registerTool(
    'get_latest_session_payload',
    {
      title: 'Get latest XDaLa session payload',
      description: 'Use this when the user asks for the payload of the latest XDaLa session. This read-only tool resolves the latest indexed session without requiring owner plus sessionId, then returns payload, apiSaves, contractSaves and extras from the final receipt.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema
      }
    },
    async ({ owner, windowHours }) => {
      const session = await getLatestXdalaSessionPayload({ owner, windowHours });
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    }
  );

  server.registerTool(
    'get_recent_xdala_sessions',
    {
      title: 'Get recent XDaLa sessions',
      description: 'Use this to list recent indexed XDaLa sessions from the read-only Explorer database, especially when the user does not know owner and sessionId. Supports optional owner filtering, time windows, result limits and payload enrichment.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        limit: z.number().int().min(1).max(100).optional(),
        includePayload: includePayloadSchema
      }
    },
    async ({ owner, windowHours, limit = 10, includePayload = false }) => {
      const sessions = await findRecentXdalaSessions({ owner, windowHours, limit, includePayload });
      return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
    }
  );


  server.registerTool(
    'list_xdala_session_owners',
    {
      title: 'List XDaLa session owners',
      description: 'Use this when the user asks which owners had XDaLa sessions, asks for the owner list, or when aggregate results show uniqueOwners but the concrete owner addresses are needed. For “last 3 weeks”, pass windowHours=504.',
      inputSchema: {
        windowHours: windowHoursSchema,
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ windowHours, limit }) => {
      const owners = await listXdalaSessionOwners({ windowHours, limit });
      return { content: [{ type: 'text', text: JSON.stringify(owners, null, 2) }] };
    }
  );

  server.registerTool(
    'list_xdala_sessions',
    {
      title: 'List XDaLa sessions',
      description: 'Use this when the user asks to list XDaLa sessions, enumerate recent sessions, or discover owner/sessionId pairs. This returns concrete owner + sessionId pairs and supports keyset pagination. For “last 3 weeks”, pass windowHours=504.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        outcome: sessionOutcomeSchema,
        limit: z.number().int().min(1).max(100).optional(),
        cursor: sessionCursorSchema
      }
    },
    async ({ owner, windowHours, outcome, limit, cursor }) => {
      const sessions = await listXdalaSessions({ owner, windowHours, outcome, limit, cursor });
      return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
    }
  );

  server.registerTool(
    'list_xdala_session_ids',
    {
      title: 'List XDaLa session IDs grouped by owner',
      description: 'Use this when the user asks for session IDs. Always returns session IDs grouped by owner because session IDs are only unique together with owner.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        outcome: sessionOutcomeSchema,
        limitOwners: z.number().int().min(1).max(500).optional(),
        maxSessionIdsPerOwner: z.number().int().min(1).max(2000).optional()
      }
    },
    async ({ owner, windowHours, outcome, limitOwners, maxSessionIdsPerOwner }) => {
      const ids = await listXdalaSessionIds({ owner, windowHours, outcome, limitOwners, maxSessionIdsPerOwner });
      return { content: [{ type: 'text', text: JSON.stringify(ids, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xdala_session_detail',
    {
      title: 'Get XDaLa session detail',
      description: 'Use this when the user asks for details, timeline, steps, payloads, or evidence for a concrete XDaLa session with owner and sessionId.',
      inputSchema: {
        owner: ownerSchema,
        sessionId: z.string().min(1),
        includePayloads: z.boolean().optional(),
        includeFinalPayload: z.boolean().optional(),
        limitSteps: z.number().int().min(1).max(1000).optional()
      }
    },
    async ({ owner, sessionId, includePayloads = false, includeFinalPayload = false, limitSteps }) => {
      const detail = await getXdalaSessionDetail({ owner, sessionId, includePayloads, includeFinalPayload, limitSteps });
      return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xdala_session_stats',
    {
      title: 'Get XDaLa session statistics',
      description: 'Use this when the user asks for aggregate XDaLa session statistics, for example “statistics for the last 2 weeks”, “success/failure counts”, “average session duration”, “average steps per session”, “top errors”, or “how many sessions ran recently”. For “last 2 weeks”, pass windowHours=336.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema
      }
    },
    async ({ owner, windowHours }) => {
      const stats = await getXdalaSessionStats({ owner, windowHours });
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xdala_session_timeseries',
    {
      title: 'Get XDaLa session timeseries',
      description: 'Use this when the user asks for XDaLa sessions over time, for example “sessions per day”, “daily sessions last 2 weeks”, “monthly session trend”, or “success/fail per day”. For “last 2 weeks by day”, pass windowHours=336 and bucket="day".',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        bucket: sessionTimeseriesBucketSchema
      }
    },
    async ({ owner, windowHours, bucket }) => {
      const series = await getXdalaSessionTimeseries({ owner, windowHours, bucket });
      return { content: [{ type: 'text', text: JSON.stringify(series, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xdala_step_stats',
    {
      title: 'Get XDaLa step statistics',
      description: 'Use this when the user asks for step-level XDaLa statistics, for example “how many steps were valid”, “invalid steps”, “failed steps”, “step gas totals”, or “step stats for a session”.',
      inputSchema: {
        owner: ownerSchema.optional(),
        sessionId: z.string().optional(),
        windowHours: windowHoursSchema,
        bucket: stepStatsBucketSchema
      }
    },
    async ({ owner, sessionId, windowHours, bucket }) => {
      const stats = await getXdalaStepStats({ owner, sessionId, windowHours, bucket });
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );


  server.registerTool(
    'get_xdala_payload_key_stats',
    {
      title: 'Get XDaLa payload key statistics',
      description: 'Use this when the user asks which payload fields/keys occurred, how often payload fields appeared, or which payload fields were empty/non-empty. For “last 14 days”, pass windowHours=336.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        outcome: sessionOutcomeSchema,
        source: payloadSourceSchema,
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ owner, windowHours, outcome, source, limit }) => {
      const stats = await getXdalaPayloadKeyStats({ owner, windowHours, outcome, source, limit });
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xdala_payload_term_stats',
    {
      title: 'Get XDaLa payload term statistics',
      description: 'Use this when the user asks for payload terms, payload words, payload Begriff statistics, or a statistic over all payload terms in a time range. For “last 14 days”, pass windowHours=336. Do not sample sessions for this task.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        outcome: sessionOutcomeSchema,
        source: payloadSourceSchema,
        mode: payloadTermModeSchema,
        minTermLength: z.number().int().min(1).max(64).optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ owner, windowHours, outcome, source, mode, minTermLength, limit }) => {
      const stats = await getXdalaPayloadTermStats({ owner, windowHours, outcome, source, mode, minTermLength, limit });
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xdala_payload_field_value_stats',
    {
      title: 'Get XDaLa payload field value statistics',
      description: 'Use this when the user asks which values occurred for a specific payload field, for example “which DocumentType values occurred?” or “top values for ReasonCategory”.',
      inputSchema: {
        owner: ownerSchema.optional(),
        windowHours: windowHoursSchema,
        outcome: sessionOutcomeSchema,
        source: payloadSourceSchema,
        field: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ owner, windowHours, outcome, source, field, limit }) => {
      const stats = await getXdalaPayloadFieldValueStats({ owner, windowHours, outcome, source, field, limit });
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xdala_active_sessions_timeseries',
    {
      title: 'Get XDaLa active sessions timeseries',
      description: 'Use this when the user asks for active/concurrent XDaLa sessions over time.',
      inputSchema: {
        windowHours: windowHoursSchema
      }
    },
    async ({ windowHours }) => {
      const series = await getXdalaActiveSessionsTimeseries({ windowHours });
      return { content: [{ type: 'text', text: JSON.stringify(series, null, 2) }] };
    }
  );

}
