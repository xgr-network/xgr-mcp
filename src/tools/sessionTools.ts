import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { explorerClient } from '../adapters/explorerClient.js';
import { rpcCall } from '../adapters/rpcClient.js';

type WakeupTargetView = {
  owner: string;
  sessionId: string;
  rootPid: string;
  pid: string;
  parentPid?: string;
  step?: string;
  status: string;
  updated: number;
  iterationStep: number;
  xrc729?: string;
  ostcId?: string;
};

type WakeupPayloadFieldView = {
  name: string;
  type: string;
  required: boolean;
  present: boolean;
  default?: unknown;
};

type WakeupPayloadSchemaResult = {
  owner: string;
  sessionId: string;
  pid: string;
  step: string;
  xrc729?: string;
  ostcId?: string;
  rule?: string;
  payloadFields?: WakeupPayloadFieldView[];
  requiredPayload?: WakeupPayloadFieldView[];
  optionalPayload?: WakeupPayloadFieldView[];
  missingPayload?: string[];
  availablePayloadKeys?: string[];
  payloadSchemaError?: string;
};

type ListWakeupTargetsByAddressResult = {
  address: string;
  targets: WakeupTargetView[];
};

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    'get_session_transactions',
    {
      title: 'Get XDaLa session transactions',
      description: 'Use this to list the blockchain transactions belonging to an XDaLa session. This returns the timeline of transaction hashes, blocks, fees and iteration steps. It does not return full engine payloads, API saves or contract read results.',
      inputSchema: {
        sessionId: z.string().min(1),
        owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ sessionId, owner, page = 1, limit = 50 }) => {
      const data = await explorerClient.getSessionTransactions(sessionId, owner, page, limit);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'get_session_status_live',
    {
      title: 'Get live XDaLa session status',
      description: 'Use this to check live session status from XGR RPC. Returns xgr_sessionAlive for a session owner and session id.',
      inputSchema: {
        sessionId: z.string().min(1),
        owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      }
    },
    async ({ sessionId, owner }) => {
      const alive = await rpcCall<unknown>('xgr_sessionAlive', [owner, sessionId]);
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId, owner, alive }, null, 2) }] };
    }
  );

  server.registerTool(
    'list_wakeup_targets_by_address',
    {
      title: 'List open XDaLa wake-up targets by address',
      description: 'Use this to list WAITING XDaLa runtime steps that the given wallet or Safe address is allowed to wake via RPC. This is read-only and calls xgr_listWakeupTargetsByAddress.',
      inputSchema: {
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        last: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ address, last }) => {
      const request = last === undefined ? { address } : { address, last };
      const data = await rpcCall<ListWakeupTargetsByAddressResult>('xgr_listWakeupTargetsByAddress', [request]);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'resolve_wakeup_payload_schema',
    {
      title: 'Resolve XDaLa wake-up payload schema',
      description: 'Use this to resolve the expected XRC-137 payload fields for one currently WAITING wake-up target from the live XDaLa session runtime state. This returns field names, types, required/optional status and missing required fields, without returning full runtime payload values.',
      inputSchema: {
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        sessionId: z.string().min(1),
        pid: z.string().min(1).optional(),
        step: z.string().min(1).optional()
      }
    },
    async ({ address, owner, sessionId, pid, step }) => {
      const request = { address, owner, sessionId, ...(pid ? { pid } : {}), ...(step ? { step } : {}) };
      const data = await rpcCall<WakeupPayloadSchemaResult>('xgr_getWakeupPayloadSchema', [request]);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'get_sessions_overview',
    {
      title: 'Get XDaLa sessions overview',
      description: 'Use this for high-level indexed XDaLa session analytics from the Explorer API.',
      inputSchema: {
        window: z.enum(['24h', '7d', '30d', '1y', 'all']).optional()
      }
    },
    async ({ window = '30d' }) => {
      const data = await explorerClient.getSessionsOverview(window);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
