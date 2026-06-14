import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { explorerClient } from '../adapters/explorerClient.js';
import { readXrc137RuleJson, readXrc729OstcJson } from '../adapters/contractReadClient.js';
import { rpcCall } from '../adapters/rpcClient.js';

type WakeupPayloadFieldView = {
  name: string;
  type: string;
  required: boolean;
  present: boolean;
  default?: unknown;
};

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
  ruleAddress?: string;
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

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    'get_session_transactions',
    {
      title: 'Get XDaLa session transactions',
      description: 'Use this to list the blockchain transactions belonging to an XDaLa session. This returns the timeline of transaction hashes, blocks, fees and iteration steps. It does not return full engine payloads, API saves or contract read results.',
      inputSchema: {
        sessionId: z.string().min(1),
        owner: addressSchema,
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ sessionId, owner, page = 1, limit = 50 }) => {
      const data = await explorerClient.getSessionTransactions(sessionId, owner, page, limit);
      return textJson(data);
    }
  );

  server.registerTool(
    'get_session_status_live',
    {
      title: 'Get live XDaLa session status',
      description: 'Use this to check live session status from XGR RPC. Returns xgr_sessionAlive for a session owner and session id.',
      inputSchema: {
        sessionId: z.string().min(1),
        owner: addressSchema
      }
    },
    async ({ sessionId, owner }) => {
      const alive = await rpcCall<unknown>('xgr_sessionAlive', [owner, sessionId]);
      return textJson({ sessionId, owner, alive });
    }
  );

  server.registerTool(
    'list_wakeup_targets_by_address',
    {
      title: 'List open XDaLa wake-up targets by address',
      description: 'Use this to list WAITING XDaLa runtime steps that the given wallet or Safe address is allowed to wake via RPC. This is read-only and calls xgr_listWakeupTargetsByAddress, then enriches public/plain XRC rule payload metadata via eth_call when available.',
      inputSchema: {
        address: addressSchema,
        last: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ address, last }) => {
      const request = last === undefined ? { address } : { address, last };
      const data = await rpcCall<ListWakeupTargetsByAddressResult>('xgr_listWakeupTargetsByAddress', [request]);
      return textJson({ ...data, targets: await enrichWakeupTargets(data.targets) });
    }
  );

  server.registerTool(
    'resolve_wakeup_payload_schema',
    {
      title: 'Resolve XDaLa wake-up payload schema',
      description: 'Use this to resolve payload fields for one currently WAITING wake-up target. It reads XRC-729.getOSTC(step -> XRC-137) and XRC-137.getRule() via eth_call for plain JSON rules. Encrypted rules are not decrypted server-side.',
      inputSchema: {
        address: addressSchema,
        owner: addressSchema,
        sessionId: z.string().min(1),
        pid: z.string().min(1).optional(),
        step: z.string().min(1).optional()
      }
    },
    async ({ address, owner, sessionId, pid, step }) => {
      const data = await rpcCall<ListWakeupTargetsByAddressResult>('xgr_listWakeupTargetsByAddress', [{ address, last: 100 }]);
      const targets = await enrichWakeupTargets(data.targets);
      const target = targets.find((item) =>
        item.owner.toLowerCase() === owner.toLowerCase() &&
        item.sessionId === sessionId &&
        (!pid || item.pid === pid) &&
        (!step || item.step === step)
      );
      const result = target ?? { owner, sessionId, pid: pid ?? '', step: step ?? '', payloadSchemaError: 'waiting wake-up target not found' };
      return textJson(result);
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
      return textJson(data);
    }
  );
}

function textJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

async function enrichWakeupTargets(targets: WakeupTargetView[]): Promise<WakeupTargetView[]> {
  if (targets.length === 0) return targets;
  return Promise.all(targets.map(enrichWakeupTarget));
}

async function enrichWakeupTarget(target: WakeupTargetView): Promise<WakeupTargetView> {
  if (hasTypedPayload(target)) return target;
  if (!target.xrc729 || !target.ostcId || !target.step) return target;

  try {
    const ostcJson = parseJsonObject(await readXrc729OstcJson(target.xrc729, target.ostcId));
    const step = findOstcStep(ostcJson, target.step);
    if (!step) return { ...target, payloadSchemaError: `step ${target.step} not found in XRC-729 OSTC` };

    const ruleAddress = extractRuleAddress(step);
    if (!ruleAddress) return { ...target, payloadSchemaError: `step ${target.step} has no XRC-137 rule address` };

    const rawRule = await readXrc137RuleJson(ruleAddress);
    const parsedRule = tryParseJson(rawRule);
    if (!isRecord(parsedRule)) {
      return {
        ...target,
        ruleAddress,
        payloadSchemaError: 'XRC-137 rule is encrypted or not plain JSON; typed schema requires local ReadKey decryption'
      };
    }

    const schema = payloadFieldsFromRule(parsedRule, new Set(target.availablePayloadKeys ?? []));
    return { ...target, ruleAddress, ...schema };
  } catch (error) {
    return {
      ...target,
      payloadSchemaError: `XRC schema eth_call failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function hasTypedPayload(target: WakeupTargetView): boolean {
  return Boolean(target.payloadFields?.length || target.requiredPayload?.length || target.optionalPayload?.length);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error('JSON value is not an object.');
  return parsed;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function findOstcStep(ostcJson: Record<string, unknown>, stepId: string): Record<string, unknown> | null {
  const structure = ostcJson.structure;
  if (isRecord(structure)) {
    const direct = structure[stepId];
    if (isRecord(direct)) return direct;
    const nestedSteps = structure.steps;
    if (Array.isArray(nestedSteps)) return findStepInArray(nestedSteps, stepId);
    if (isRecord(nestedSteps)) return findStepInRecord(nestedSteps, stepId);
  }
  const steps = ostcJson.steps;
  if (Array.isArray(steps)) return findStepInArray(steps, stepId);
  if (isRecord(steps)) return findStepInRecord(steps, stepId);
  return null;
}

function findStepInRecord(steps: Record<string, unknown>, stepId: string): Record<string, unknown> | null {
  const value = steps[stepId];
  if (!isRecord(value)) return null;
  return { id: stepId, ...value };
}

function findStepInArray(steps: unknown[], stepId: string): Record<string, unknown> | null {
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const id = String(step.id ?? step.stepId ?? step.step_id ?? '');
    if (id === stepId) return step;
  }
  return null;
}

function extractRuleAddress(step: Record<string, unknown>): string | null {
  const rule = step.rule ?? step.ruleAddress ?? step.xrc137 ?? step.rule_contract;
  if (typeof rule === 'string' && /^0x[0-9a-fA-F]{40}$/.test(rule)) return rule.toLowerCase();
  if (isRecord(rule)) {
    const candidate = rule.address ?? rule.contractAddress ?? rule.contract_address;
    if (typeof candidate === 'string' && /^0x[0-9a-fA-F]{40}$/.test(candidate)) return candidate.toLowerCase();
  }
  return null;
}

function payloadFieldsFromRule(rule: Record<string, unknown>, presentKeys: Set<string>): Pick<WakeupTargetView, 'payloadFields' | 'requiredPayload' | 'optionalPayload' | 'missingPayload'> {
  const payload = rule.payload;
  if (!isRecord(payload)) return { payloadFields: [], requiredPayload: [], optionalPayload: [], missingPayload: [] };

  const fields: WakeupPayloadFieldView[] = [];
  for (const [name, spec] of Object.entries(payload)) {
    if (!name.trim() || name.startsWith('__')) continue;
    const field = payloadFieldFromSpec(name, spec, presentKeys.has(name));
    if (field) fields.push(field);
  }

  fields.sort((a, b) => a.name.localeCompare(b.name));
  const requiredPayload = fields.filter((field) => field.required);
  const optionalPayload = fields.filter((field) => !field.required);
  const missingPayload = requiredPayload.filter((field) => !field.present).map((field) => field.name).sort();
  return { payloadFields: fields, requiredPayload, optionalPayload, missingPayload };
}

function payloadFieldFromSpec(name: string, spec: unknown, present: boolean): WakeupPayloadFieldView | null {
  if (isRecord(spec)) {
    const type = typeof spec.type === 'string' && spec.type.trim() ? spec.type.trim() : 'unknown';
    const hasDefault = Object.prototype.hasOwnProperty.call(spec, 'default');
    const required = spec.required === false || spec.optional === true || hasDefault ? false : true;
    return {
      name,
      type,
      required,
      present,
      ...(hasDefault ? { default: spec.default } : {})
    };
  }

  if (typeof spec === 'string' && spec.trim()) {
    const value = spec.trim();
    const type = value === 'required' || value === 'optional' ? 'unknown' : value;
    return { name, type, required: value !== 'optional', present };
  }

  return { name, type: 'unknown', required: true, present };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
