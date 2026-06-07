import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readXrc137RuleJson, readXrc729OstcJson } from '../adapters/contractReadClient.js';
import { rpcCall } from '../adapters/rpcClient.js';
import { xrcExplorerClient } from '../adapters/xrcExplorerClient.js';
import {
  getXrcContractDb,
  getXrcFailureStatsDb,
  getXrcUsageDb,
  hasXrcDb,
  listUnusedXrc137RulesDb,
  listXrc729OstcStateDb,
  listXrcContractsDb,
  listXrcEventsDb,
  listXrcProcessSessionsDb,
  normalizeXrcLimit,
  safeDb,
  type XrcAction,
  type XrcType
} from '../adapters/xrcDbClient.js';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const xrcTypeSchema = z.enum(['xrc137', 'xrc729']);
const xrcActionSchema = z.enum(['deploy', 'update', 'ostc_update', 'ostc_delete']);
const pageSchema = z.number().int().min(1).optional();
const limitSchema = z.number().int().min(1).max(200).optional();
const windowHoursSchema = z.number().int().min(0).max(8760).optional();
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function textJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function firstArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['items', 'contracts', 'events', 'states', 'ostc', 'data', 'results', 'rows']) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstObject(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  for (const key of ['contract', 'data', 'item', 'result']) {
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return obj;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return null;
}

function normalizeContract(item: unknown) {
  const obj = firstObject(item) ?? {};
  return {
    contractAddress: pick(obj, 'contractAddress', 'contract_address', 'address'),
    xrcType: pick(obj, 'xrcType', 'xrc_type', 'type'),
    owner: pick(obj, 'owner'),
    nameXrc: pick(obj, 'nameXrc', 'name_xrc', 'name'),
    schemaVersion: pick(obj, 'schemaVersion', 'schema_version'),
    firstSeenBlock: pick(obj, 'firstSeenBlock', 'first_seen_block'),
    firstSeenTxHash: pick(obj, 'firstSeenTxHash', 'first_seen_tx_hash'),
    firstSeenLogIndex: pick(obj, 'firstSeenLogIndex', 'first_seen_log_index'),
    lastSeenBlock: pick(obj, 'lastSeenBlock', 'last_seen_block'),
    lastEventTxHash: pick(obj, 'lastEventTxHash', 'last_event_tx_hash'),
    lastEventLogIndex: pick(obj, 'lastEventLogIndex', 'last_event_log_index'),
    ruleHash: pick(obj, 'ruleHash', 'rule_hash'),
    ruleVersion: pick(obj, 'ruleVersion', 'rule_version'),
    encryptedState: pick(obj, 'encryptedState', 'encrypted_state'),
    nameHash: pick(obj, 'nameHash', 'name_hash'),
    createdAt: pick(obj, 'createdAt', 'created_at'),
    updatedAt: pick(obj, 'updatedAt', 'updated_at')
  };
}

function normalizeEvent(item: unknown) {
  const obj = firstObject(item) ?? {};
  return {
    txHash: pick(obj, 'txHash', 'tx_hash'),
    logIndex: pick(obj, 'logIndex', 'log_index'),
    blockNumber: pick(obj, 'blockNumber', 'block_number'),
    blockTimestamp: pick(obj, 'blockTimestamp', 'block_timestamp'),
    contractAddress: pick(obj, 'contractAddress', 'contract_address', 'address'),
    xrcType: pick(obj, 'xrcType', 'xrc_type', 'type'),
    eventName: pick(obj, 'eventName', 'event_name'),
    action: pick(obj, 'action'),
    owner: pick(obj, 'owner'),
    topic0: pick(obj, 'topic0'),
    ruleHash: pick(obj, 'ruleHash', 'rule_hash'),
    ruleVersion: pick(obj, 'ruleVersion', 'rule_version'),
    encryptedState: pick(obj, 'encryptedState', 'encrypted_state'),
    nameXrc: pick(obj, 'nameXrc', 'name_xrc', 'name'),
    schemaVersion: pick(obj, 'schemaVersion', 'schema_version'),
    nameHash: pick(obj, 'nameHash', 'name_hash'),
    ostcId: pick(obj, 'ostcId', 'ostc_id'),
    ostcIdHash: pick(obj, 'ostcIdHash', 'ostc_id_hash'),
    ostcHash: pick(obj, 'ostcHash', 'ostc_hash'),
    previousOstcHash: pick(obj, 'previousOstcHash', 'previous_ostc_hash'),
    ostcVersion: pick(obj, 'ostcVersion', 'ostc_version', 'version'),
    previousOstcVersion: pick(obj, 'previousOstcVersion', 'previous_ostc_version'),
    ostcUpdatedAt: pick(obj, 'ostcUpdatedAt', 'ostc_updated_at'),
    args: pick(obj, 'args'),
    createdAt: pick(obj, 'createdAt', 'created_at')
  };
}

function normalizeOstcState(item: unknown) {
  const obj = firstObject(item) ?? {};
  return {
    xrc729Address: pick(obj, 'xrc729Address', 'xrc729_address', 'contractAddress', 'contract_address'),
    ostcId: pick(obj, 'ostcId', 'ostc_id', 'id'),
    ostcIdHash: pick(obj, 'ostcIdHash', 'ostc_id_hash'),
    ostcHash: pick(obj, 'ostcHash', 'ostc_hash'),
    version: pick(obj, 'version', 'ostcVersion', 'ostc_version'),
    updatedAt: pick(obj, 'updatedAt', 'updated_at'),
    deleted: pick(obj, 'deleted'),
    lastTxHash: pick(obj, 'lastTxHash', 'last_tx_hash', 'txHash', 'tx_hash'),
    lastBlock: pick(obj, 'lastBlock', 'last_block', 'blockNumber', 'block_number'),
    lastLogIndex: pick(obj, 'lastLogIndex', 'last_log_index', 'logIndex', 'log_index'),
    updatedDbAt: pick(obj, 'updatedDbAt', 'updated_db_at'),
    ostcJson: pick(obj, 'ostcJson', 'ostc_json', 'ostc', 'json', 'payload')
  };
}

async function explorerOrDbListContracts(input: { owner?: string; type?: XrcType; page?: number; limit?: number }) {
  try {
    const response = input.owner
      ? await xrcExplorerClient.listContracts(input)
      : await xrcExplorerClient.listContracts(input);
    const contracts = firstArray(response).map(normalizeContract);
    return { source: 'explorer_api', contracts };
  } catch (error) {
    const db = await safeDb(() => listXrcContractsDb(input));
    if (db.ok) return { source: 'explorer_db', contracts: db.value };
    return { source: 'unavailable', contracts: [], warning: `Explorer API failed (${error instanceof Error ? error.message : String(error)}); DB fallback unavailable: ${db.message}` };
  }
}

async function explorerOrDbGetContract(address: string) {
  try {
    const response = await xrcExplorerClient.getContract(address);
    if (response === null) return { source: 'explorer_api', contract: null };
    return { source: 'explorer_api', contract: normalizeContract(response) };
  } catch (error) {
    const db = await safeDb(() => getXrcContractDb(address));
    if (db.ok) return { source: 'explorer_db', contract: db.value };
    return { source: 'unavailable', contract: null, warning: `Explorer API failed (${error instanceof Error ? error.message : String(error)}); DB fallback unavailable: ${db.message}` };
  }
}

async function explorerOrDbListEvents(input: { owner?: string; contract?: string; type?: XrcType; action?: XrcAction; txHash?: string; fromBlock?: number; toBlock?: number; page?: number; limit?: number }) {
  try {
    const response = input.owner && !input.contract && !input.txHash && !input.fromBlock && !input.toBlock
      ? await xrcExplorerClient.listAddressEvents(input.owner, input)
      : await xrcExplorerClient.listEvents(input);
    return { source: 'explorer_api', events: firstArray(response).map(normalizeEvent) };
  } catch (error) {
    const db = await safeDb(() => listXrcEventsDb(input));
    if (db.ok) return { source: 'explorer_db', events: db.value };
    return { source: 'unavailable', events: [], warning: `Explorer API failed (${error instanceof Error ? error.message : String(error)}); DB fallback unavailable: ${db.message}` };
  }
}

async function explorerOrDbOstcState(address: string, input: { includeDeleted?: boolean; page?: number; limit?: number }) {
  try {
    const response = await xrcExplorerClient.listXrc729OstcState(address, input);
    return { source: 'explorer_api', states: firstArray(response).map(normalizeOstcState) };
  } catch (error) {
    const db = await safeDb(() => listXrc729OstcStateDb(address, input.includeDeleted, input.page, input.limit));
    if (db.ok) return { source: 'explorer_db', states: db.value };
    return { source: 'unavailable', states: [], warning: `Explorer API failed (${error instanceof Error ? error.message : String(error)}); DB fallback unavailable: ${db.message}` };
  }
}

function coerceNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : -1;
}

function chooseLatestOstc(states: Array<Record<string, unknown>>, ostcId?: string) {
  const filtered = states.filter((state) => (ostcId ? state.ostcId === ostcId : state.deleted !== true));
  return filtered.sort((a, b) =>
    coerceNumber(b.lastBlock) - coerceNumber(a.lastBlock) ||
    coerceNumber(b.lastLogIndex) - coerceNumber(a.lastLogIndex) ||
    coerceNumber(b.version) - coerceNumber(a.version)
  )[0] ?? null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractSteps(ostcJson: unknown): Array<Record<string, unknown>> {
  const parsed = parseMaybeJson(ostcJson);
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  const candidates = [
    obj.steps,
    Array.isArray(obj.structure) || (obj.structure && typeof obj.structure === 'object') ? obj.structure : undefined,
    obj.structure && typeof obj.structure === 'object' && !Array.isArray(obj.structure) ? (obj.structure as Record<string, unknown>).steps : undefined
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((step): step is Record<string, unknown> => Boolean(step && typeof step === 'object' && !Array.isArray(step)));
    if (candidate && typeof candidate === 'object') {
      return Object.entries(candidate as Record<string, unknown>).map(([id, value]) => ({ id, ...(value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}) }));
    }
  }
  return [];
}

function extractRuleAddress(step: Record<string, unknown>): string | null {
  const rule = step.rule ?? step.ruleAddress ?? step.xrc137 ?? step.rule_contract;
  if (typeof rule === 'string') return /^0x[0-9a-fA-F]{40}$/.test(rule) ? rule : null;
  if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    const candidate = pick(rule as Record<string, unknown>, 'address', 'contractAddress', 'contract_address');
    return typeof candidate === 'string' && /^0x[0-9a-fA-F]{40}$/.test(candidate) ? candidate : null;
  }
  return null;
}

function extractKeys(value: unknown): string[] {
  const parsed = parseMaybeJson(value);
  const keys = new Set<string>();
  function visit(node: unknown, depth: number): void {
    if (depth > 4 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (['payload', 'inputs', 'input', 'requiredInputs', 'requiredInputKeys', 'outputs', 'output', 'onValid', 'onInvalid', 'apiSaves', 'contractSaves'].includes(key)) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          for (const childKey of Object.keys(child as Record<string, unknown>)) keys.add(childKey);
        }
      }
      visit(child, depth + 1);
    }
  }
  visit(parsed, 0);
  return [...keys];
}

function overlap(a: string[], b: string[]): number {
  const bSet = new Set(b);
  return a.filter((key) => bSet.has(key)).length;
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : null;
}

function decodeEthAddress(data: string): string | null {
  const hex = data.replace(/^0x/, '');
  if (hex.length < 64) return null;
  return normalizeAddress(`0x${hex.slice(24, 64)}`);
}

function decodeEthAddressArray(data: string): string[] | null {
  const hex = data.replace(/^0x/, '');
  if (hex.length < 128) return null;
  try {
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
    if (!Number.isSafeInteger(offset) || offset < 0) return null;
    const lenPos = offset * 2;
    if (hex.length < lenPos + 64) return null;
    const length = Number(BigInt(`0x${hex.slice(lenPos, lenPos + 64)}`));
    if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) return null;
    const addresses: string[] = [];
    for (let i = 0; i < length; i += 1) {
      const word = hex.slice(lenPos + 64 + i * 64, lenPos + 128 + i * 64);
      const address = normalizeAddress(`0x${word.slice(24)}`);
      if (address) addresses.push(address);
    }
    return addresses;
  } catch {
    return null;
  }
}

async function ethCall(address: string, data: `0x${string}`): Promise<string> {
  return rpcCall<string>('eth_call', [{ to: address, data }, 'latest']);
}

type Xrc729Authority = {
  orchestration: string;
  owner?: string;
  executors?: string[];
  executorWildcard: boolean;
  authorityStatus: 'resolved' | 'unavailable';
  authoritySource: {
    owner?: 'owner()' | 'getOwner()' | 'explorer_index';
    executors?: 'getExecutorList()';
  };
  warnings: string[];
};

async function readXrc729Authority(orchestration: string): Promise<Xrc729Authority> {
  const warnings: string[] = [];
  let owner: string | null = null;
  let ownerSource: 'owner()' | 'getOwner()' | 'explorer_index' | null = null;
  let executors: string[] | null = null;
  let executorWildcard = false;

  const ownerReadWarnings: string[] = [];
  try {
    owner = decodeEthAddress(await ethCall(orchestration, '0x8da5cb5b'));
    if (owner) ownerSource = 'owner()';
  } catch (error) {
    ownerReadWarnings.push(`owner() read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!owner) {
    try {
      owner = decodeEthAddress(await ethCall(orchestration, '0x893d20e8'));
      if (owner) ownerSource = 'getOwner()';
    } catch (error) {
      ownerReadWarnings.push(`getOwner() read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!owner) warnings.push(...ownerReadWarnings);

  try {
    const decoded = decodeEthAddressArray(await ethCall(orchestration, '0x9e8f4b8f'));
    if (decoded) {
      executorWildcard = decoded.includes(ZERO_ADDRESS);
      executors = decoded.filter((address) => address !== ZERO_ADDRESS);
    } else {
      warnings.push('getExecutorList() returned undecodable data.');
    }
  } catch (error) {
    warnings.push(`getExecutorList() read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    orchestration,
    owner: owner ?? undefined,
    executors: executors ?? undefined,
    executorWildcard,
    authorityStatus: owner || executors ? 'resolved' : 'unavailable',
    authoritySource: {
      owner: ownerSource ?? undefined,
      executors: executors ? 'getExecutorList()' : undefined
    },
    warnings
  };
}

function authorityWithIndexedOwner(
  authority: Xrc729Authority,
  indexedOwner: string | null
): Xrc729Authority {
  if (!indexedOwner) return authority;

  if (authority.owner) {
    if (authority.owner !== indexedOwner) {
      return {
        ...authority,
        warnings: [
          ...authority.warnings,
          `INDEXED_OWNER_MISMATCH: indexed owner ${indexedOwner} differs from RPC owner ${authority.owner}.`
        ]
      };
    }
    return authority;
  }

  return {
    ...authority,
    owner: indexedOwner,
    authorityStatus: 'resolved',
    authoritySource: {
      ...authority.authoritySource,
      owner: 'explorer_index'
    },
    warnings: [
      ...authority.warnings,
      'OWNER_FROM_INDEX_FALLBACK: owner()/getOwner() was unavailable; owner role was derived from indexed XRC owner metadata.'
    ]
  };
}

function branchTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const spawns = (value as Record<string, unknown>).spawns;
    if (Array.isArray(spawns)) return spawns.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function getStepId(step: Record<string, unknown>): string {
  return String(step.id ?? step.stepId ?? step.step_id ?? '');
}

function inferEntryStep(steps: Array<Record<string, unknown>>): { entryStep?: string; warnings: string[] } {
  if (steps.length === 0) return { warnings: ['No runtime steps found; entry step unavailable.'] };
  const incoming = new Set<string>();
  for (const step of steps) {
    for (const target of [...branchTargets(step.onValid), ...branchTargets(step.onInvalid)]) incoming.add(target);
  }
  const entries = steps.filter((step) => {
    const id = getStepId(step);
    return id.length > 0 && !incoming.has(id);
  });
  if (entries.length === 1) return { entryStep: getStepId(entries[0]), warnings: [] };
  return {
    entryStep: getStepId(steps[0]),
    warnings: ['ENTRY_STEP_INFERRED_LOW_CONFIDENCE']
  };
}

function payloadFieldsFromRule(rule: unknown): {
  requiredPayload: Array<Record<string, unknown>>;
  optionalPayload: Array<Record<string, unknown>>;
  defaultPayload: Record<string, unknown>;
  suggestedPayload: Record<string, unknown>;
} {
  const parsed = parseMaybeJson(rule);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { requiredPayload: [], optionalPayload: [], defaultPayload: {}, suggestedPayload: {} };
  }
  const payload = (parsed as Record<string, unknown>).payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { requiredPayload: [], optionalPayload: [], defaultPayload: {}, suggestedPayload: {} };
  }
  const requiredPayload: Array<Record<string, unknown>> = [];
  const optionalPayload: Array<Record<string, unknown>> = [];
  const defaultPayload: Record<string, unknown> = {};
  const suggestedPayload: Record<string, unknown> = {};  
  for (const [name, spec] of Object.entries(payload as Record<string, unknown>)) {
    const specObj = spec && typeof spec === 'object' && !Array.isArray(spec)
      ? spec as Record<string, unknown>
      : null;    
    const item = spec && typeof spec === 'object' && !Array.isArray(spec)
      ? { name, ...(spec as Record<string, unknown>) }
      : { name };

    if (specObj && Object.prototype.hasOwnProperty.call(specObj, 'default')) {
      optionalPayload.push(item);
      defaultPayload[name] = specObj.default;
      suggestedPayload[name] = specObj.default;
    } else {
      requiredPayload.push(item);
      suggestedPayload[name] = `<${String(specObj?.type ?? 'value')}>`;
    }
  }
  return {
    requiredPayload: requiredPayload.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    optionalPayload: optionalPayload.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    defaultPayload,
    suggestedPayload
  };
}

type WorkflowStartShape = {
  ostcId?: string;
  ostc?: Record<string, unknown>;
  entryStep?: string;
  entryRuleAddress?: string;
  requiredPayload: Array<Record<string, unknown>>;
  optionalPayload: Array<Record<string, unknown>>;
  defaultPayload: Record<string, unknown>;
  suggestedPayload: Record<string, unknown>;
  warnings: string[];
  graph?: { steps: Array<Record<string, unknown>> };
};

async function resolveWorkflowStartShape(
  xrc729Address: string,
  ostcId?: string,
  includeGraph = false
): Promise<WorkflowStartShape> {
  const ostcResult = await explorerOrDbOstcState(xrc729Address, { includeDeleted: Boolean(ostcId), limit: 200 });
  const chosen = chooseLatestOstc(ostcResult.states as Array<Record<string, unknown>>, ostcId);
  const chosenOstcId = typeof chosen?.ostcId === 'string' ? chosen.ostcId : ostcId;
  const warnings: string[] = [ostcResult.warning].filter((warning): warning is string => Boolean(warning));
  let ostcJson: unknown = chosen ? parseMaybeJson(chosen.ostcJson) : null;
  if ((!ostcJson || typeof ostcJson === 'string') && chosenOstcId) {
    try {
      ostcJson = parseMaybeJson(await readXrc729OstcJson(xrc729Address, chosenOstcId));
    } catch (error) {
      warnings.push(`XRC729.getOSTC(${chosenOstcId}) read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const steps = extractSteps(ostcJson);
  const entry = inferEntryStep(steps);
  warnings.push(...entry.warnings);
  const entryStep = steps.find((step) => getStepId(step) === entry.entryStep);
  const ruleAddress = entryStep ? extractRuleAddress(entryStep) : null;
  let requiredPayload: Array<Record<string, unknown>> = [];
  let optionalPayload: Array<Record<string, unknown>> = [];
  let defaultPayload: Record<string, unknown> = {};
  let suggestedPayload: Record<string, unknown> = {};  
  if (ruleAddress) {
    try {
      ({ requiredPayload, optionalPayload, defaultPayload, suggestedPayload } = payloadFieldsFromRule(await readXrc137RuleJson(ruleAddress)));
    } catch (error) {
      warnings.push(`XRC137.getRule() for entry step failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (entryStep) {
    warnings.push('Entry step has no deployed XRC-137 rule address.');
  }
  return {
    ostcId: chosenOstcId,
    ostc: chosen,
    entryStep: entry.entryStep,
    entryRuleAddress: ruleAddress ?? undefined,
    requiredPayload,    
    optionalPayload,
    defaultPayload,
    suggestedPayload,    
    warnings,
    ...(includeGraph ? { graph: { steps } } : {})
  };
}

function workflowRole(address: string, authority: Awaited<ReturnType<typeof readXrc729Authority>>): 'owner' | 'executor' | 'wildcard_executor' | 'none' {
  if (authority.owner === address) return 'owner';
  if (authority.executors?.includes(address)) return 'executor';
  if (authority.executorWildcard) return 'wildcard_executor';
  return 'none';
}

function workflowPayloadSignature(requiredPayload: Array<Record<string, unknown>>, optionalPayload: Array<Record<string, unknown>>): string {
  const req = requiredPayload.map((field) => String(field.name)).sort().join(',');
  const opt = optionalPayload.map((field) => String(field.name)).sort().join(',');
  return `required:${req}|optional:${opt}`;
}

export function registerXrcTools(server: McpServer): void {
  server.registerTool('get_xrc729_authority', {
    title: 'Get XRC-729 authority',
    description: 'Read-only authority lookup for one XRC-729 orchestration contract. Reads owner()/getOwner() and getExecutorList(), detects zero-address executor wildcard, and never signs, submits, executes, or creates a handoff.',
    inputSchema: { orchestration: addressSchema }
  }, async ({ orchestration }) => textJson(await readXrc729Authority(orchestration.toLowerCase())));

  server.registerTool('find_startable_xdala_workflows', {
    title: 'Find startable XDaLa workflows',
    description: 'Read-only discovery of deployed XRC-729 workflows that a given address can start as owner, executor, or wildcard executor. Use this whenever the user provides an address and asks which sessions/workflows they can start. This tool does not create session-start handoffs.',
    inputSchema: {
      address: addressSchema,
      network: z.string().min(1).optional(),
      owner: addressSchema.optional(),
      includeOwner: z.boolean().optional(),
      includeExecutor: z.boolean().optional(),
      includeWildcard: z.boolean().optional(),
      includePayloadSchema: z.boolean().optional(),
      includeGraph: z.boolean().optional(),
      limit: limitSchema
    }
  }, async ({ address, network, owner, includeOwner = true, includeExecutor = true, includeWildcard = true, includePayloadSchema = true, includeGraph = false, limit }) => {
    const normalizedAddress = address.toLowerCase();
    const max = normalizeXrcLimit(limit);
    const warnings: string[] = [];
    const ownerCandidates = owner ? [owner.toLowerCase()] : [normalizedAddress];
    const candidateMap = new Map<string, Record<string, unknown>>();

    for (const ownerCandidate of ownerCandidates) {
      const result = await explorerOrDbListContracts({ owner: ownerCandidate, type: 'xrc729', limit: 200 });
      warnings.push(...[result.warning].filter((warning): warning is string => Boolean(warning)));
      for (const contract of result.contracts) {
        const candidate = normalizeAddress(contract.contractAddress);
        if (candidate) candidateMap.set(candidate, contract as Record<string, unknown>);
      }
    }

    if (includeExecutor || includeWildcard) {
      warnings.push('Executor/wildcard discovery scans the first 200 indexed XRC-729 contracts; results may be incomplete if more exist.');
      const result = await explorerOrDbListContracts({ type: 'xrc729', limit: 200 });
      warnings.push(...[result.warning].filter((warning): warning is string => Boolean(warning)));
      for (const contract of result.contracts) {
        const candidate = normalizeAddress(contract.contractAddress);
        if (candidate) candidateMap.set(candidate, contract as Record<string, unknown>);
      }
    }

    const workflows = [];
    for (const [orchestration, contract] of candidateMap.entries()) {
      const indexedOwner = normalizeAddress(contract.owner);
      const authority = authorityWithIndexedOwner(
        await readXrc729Authority(orchestration),
        indexedOwner
      );
      const role = workflowRole(normalizedAddress, authority);
      if (role === 'none') continue;
      if (role === 'owner' && !includeOwner) continue;
      if (role === 'executor' && !includeExecutor) continue;
      if (role === 'wildcard_executor' && !includeWildcard) continue;
      const shape = includePayloadSchema || includeGraph
        ? await resolveWorkflowStartShape(orchestration, undefined, includeGraph)
        : { ostcId: undefined, entryStep: undefined, entryRuleAddress: undefined, requiredPayload: [], optionalPayload: [], defaultPayload: {}, suggestedPayload: {}, warnings: [], graph: undefined };
      workflows.push({
        network,
        orchestration,
        title: contract.nameXrc ?? shape.ostcId ?? orchestration,
        ostcId: shape.ostcId,
        role,
        startable: true,
        owner: authority.owner,
        executors: authority.executors,
        executorWildcard: authority.executorWildcard,
        entryStep: shape.entryStep,
        entryRuleAddress: shape.entryRuleAddress,
        requiredPayload: includePayloadSchema ? shape.requiredPayload : undefined,
        optionalPayload: includePayloadSchema ? shape.optionalPayload : undefined,
        defaultPayload: includePayloadSchema ? shape.defaultPayload : undefined,
        suggestedPayload: includePayloadSchema ? shape.suggestedPayload : undefined,        
        confidence: shape.entryStep ? 'high' : 'low',
        warnings: [...authority.warnings, ...shape.warnings],
        graph: includeGraph ? shape.graph : undefined,
        contract
      });
      if (workflows.length >= max) break;
    }

    const groupMap = new Map<string, Record<string, unknown>>();
    for (const workflow of workflows) {
      const key = `${workflow.ostcId ?? 'unknown'}|${workflow.entryStep ?? 'unknown'}|${workflow.role}|${workflowPayloadSignature(workflow.requiredPayload ?? [], workflow.optionalPayload ?? [])}`;
      const existing = groupMap.get(key);
      if (existing) {
        (existing.orchestrations as string[]).push(workflow.orchestration);
      } else {
        groupMap.set(key, {
          ostcId: workflow.ostcId,
          entryStep: workflow.entryStep,
          role: workflow.role,
          orchestrations: [workflow.orchestration],
          requiredPayload: workflow.requiredPayload,
          optionalPayload: workflow.optionalPayload,
          defaultPayload: workflow.defaultPayload,
          suggestedPayload: workflow.suggestedPayload
        });
      }
    }

    return textJson({
      address: normalizedAddress,
      network,
      workflows,
      groups: [...groupMap.values()],
      warnings
    });
  });

  server.registerTool('list_xrc_contracts', {
    title: 'List indexed XRC contracts',
    description: 'Read-only list of indexed XRC-137/XRC-729 contracts globally or filtered by owner/type.',
    inputSchema: { owner: addressSchema.optional(), type: xrcTypeSchema.optional(), page: pageSchema, limit: limitSchema }
  }, async ({ owner, type, page, limit }) => textJson(await explorerOrDbListContracts({ owner, type, page, limit })));

  server.registerTool('get_xrc_contract', {
    title: 'Get indexed XRC contract',
    description: 'Read-only lookup of one indexed XRC contract by address.',
    inputSchema: { address: addressSchema }
  }, async ({ address }) => {
    const result = await explorerOrDbGetContract(address);
    return textJson(result.contract ? result : { ...result, message: `No indexed XRC contract found for ${address}.` });
  });

  server.registerTool('list_xrc_events', {
    title: 'List indexed XRC events',
    description: 'Read-only list of XRC events globally or by owner, contract, type/action, tx hash, or block range.',
    inputSchema: {
      owner: addressSchema.optional(),
      contract: addressSchema.optional(),
      type: xrcTypeSchema.optional(),
      action: xrcActionSchema.optional(),
      txHash: z.string().min(1).optional(),
      fromBlock: z.number().int().min(0).optional(),
      toBlock: z.number().int().min(0).optional(),
      page: pageSchema,
      limit: limitSchema
    }
  }, async (input) => textJson(await explorerOrDbListEvents(input)));

  server.registerTool('get_xrc_contract_events', {
    title: 'Get indexed XRC contract events',
    description: 'Read-only list of all indexed XRC events for one contract.',
    inputSchema: { address: addressSchema, page: pageSchema, limit: limitSchema }
  }, async ({ address, page, limit }) => {
    try {
      const response = await xrcExplorerClient.listContractEvents(address, { page, limit });
      return textJson({ source: 'explorer_api', events: firstArray(response).map(normalizeEvent) });
    } catch (error) {
      const db = await safeDb(() => listXrcEventsDb({ contract: address, page, limit }));
      return textJson(db.ok ? { source: 'explorer_db', events: db.value } : { source: 'unavailable', events: [], warning: `Explorer API failed (${error instanceof Error ? error.message : String(error)}); DB fallback unavailable: ${db.message}` });
    }
  });

  server.registerTool('get_xrc729_ostc_state', {
    title: 'Get XRC-729 OSTC state',
    description: 'Read-only list of indexed OSTC state entries for an XRC-729 contract.',
    inputSchema: { address: addressSchema, includeDeleted: z.boolean().optional(), page: pageSchema, limit: limitSchema }
  }, async ({ address, includeDeleted = false, page, limit }) => textJson(await explorerOrDbOstcState(address, { includeDeleted, page, limit })));

  server.registerTool('get_xrc_owner_summary', {
    title: 'Get XRC owner summary',
    description: 'Compact read-only summary of XRC-137/XRC-729 assets and recent XRC events for an owner.',
    inputSchema: { owner: addressSchema }
  }, async ({ owner }) => {
    const [xrc137, xrc729, events] = await Promise.all([
      explorerOrDbListContracts({ owner, type: 'xrc137', limit: 50 }),
      explorerOrDbListContracts({ owner, type: 'xrc729', limit: 50 }),
      explorerOrDbListEvents({ owner, limit: 25 })
    ]);
    const latestXrc137 = [...xrc137.contracts].sort((a, b) => coerceNumber(b.lastSeenBlock) - coerceNumber(a.lastSeenBlock))[0] ?? null;
    const latestXrc729 = [...xrc729.contracts].sort((a, b) => coerceNumber(b.lastSeenBlock) - coerceNumber(a.lastSeenBlock))[0] ?? null;
    const lastEventBlock = events.events.reduce((max, event) => Math.max(max, coerceNumber(event.blockNumber)), -1);
    return textJson({
      owner,
      xrc137Count: xrc137.contracts.length,
      xrc729Count: xrc729.contracts.length,
      encryptedXrc137Count: xrc137.contracts.filter((contract) => contract.encryptedState === true).length,
      recentUpdates: events.events.slice(0, 10),
      lastEventBlock: lastEventBlock >= 0 ? lastEventBlock : null,
      latestXrc729,
      latestXrc137,
      sources: { xrc137: xrc137.source, xrc729: xrc729.source, events: events.source },
      warnings: [xrc137.warning, xrc729.warning, events.warning].filter(Boolean)
    });
  });

  server.registerTool('read_xrc729_ostc_json', {
    title: 'Read XRC-729 OSTC JSON',
    description: 'Read-only eth_call to XRC729.getOSTC(ostcId), returning the runtime OSTC JSON string.',
    inputSchema: { address: addressSchema, ostcId: z.string().min(1) }
  }, async ({ address, ostcId }) => textJson({ address, ostcId, ostcJson: await readXrc729OstcJson(address, ostcId) }));

  server.registerTool('read_xrc137_rule_json', {
    title: 'Read XRC-137 rule JSON',
    description: 'Read-only eth_call to XRC137.getRule(), returning the runtime rule JSON string.',
    inputSchema: { address: addressSchema }
  }, async ({ address }) => textJson({ address, ruleJson: await readXrc137RuleJson(address) }));

  server.registerTool('resolve_xrc729_process_graph', {
    title: 'Resolve XRC-729 process graph',
    description: 'Resolve deployed XRC-729 OSTC runtime JSON and linked indexed XRC-137 rule contracts without mutating chain state.',
    inputSchema: { xrc729Address: addressSchema, ostcId: z.string().min(1).optional(), includeRules: z.boolean().optional(), includeUsage: z.boolean().optional() }
  }, async ({ xrc729Address, ostcId, includeRules = false, includeUsage = false }) => {
    const [contractResult, ostcResult] = await Promise.all([
      explorerOrDbGetContract(xrc729Address),
      explorerOrDbOstcState(xrc729Address, { includeDeleted: Boolean(ostcId), limit: 200 })
    ]);
    const chosen = chooseLatestOstc(ostcResult.states as Array<Record<string, unknown>>, ostcId);
    const chosenOstcId = typeof chosen?.ostcId === 'string' ? chosen.ostcId : ostcId;
    const warnings: string[] = [];
    if (!chosen) warnings.push('No indexed OSTC state was found for this XRC-729 contract.');

    let ostcJsonSource: 'explorer_index' | 'rpc_getOSTC' | null = null;
    let ostcJson = chosen ? parseMaybeJson(chosen.ostcJson) : null;
    if (ostcJson && typeof ostcJson !== 'string') {
      ostcJsonSource = 'explorer_index';
    } else if (chosenOstcId) {
      try {
        ostcJson = parseMaybeJson(await readXrc729OstcJson(xrc729Address, chosenOstcId));
        if (ostcJson && typeof ostcJson !== 'string') ostcJsonSource = 'rpc_getOSTC';
      } catch (error) {
        warnings.push(`XRC729.getOSTC(${chosenOstcId}) eth_call failed or could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      warnings.push('No OSTC id was provided and no indexed OSTC metadata was available to choose one.');
    }

    if (!ostcJsonSource) warnings.push('OSTC JSON was not available from Explorer or XRC729.getOSTC; returning metadata only.');
    const rawSteps = ostcJsonSource ? extractSteps(ostcJson) : [];
    if (ostcJsonSource && rawSteps.length === 0) warnings.push('OSTC JSON was read but no structure steps with rule references were found.');

    const unresolvedRules: string[] = [];
    const steps = await Promise.all(rawSteps.map(async (step) => {
      const stepId = String(step.id ?? step.stepId ?? step.step_id ?? '');
      const ruleAddress = extractRuleAddress(step);
      const xrc137Result = ruleAddress ? await explorerOrDbGetContract(ruleAddress) : null;
      const xrc137 = xrc137Result?.contract ?? null;
      if (ruleAddress && !xrc137) unresolvedRules.push(ruleAddress);
      const ruleWarnings: string[] = [xrc137Result?.warning].filter((warning): warning is string => Boolean(warning));
      let rule: unknown = null;
      if (includeRules && ruleAddress) {
        try {
          rule = parseMaybeJson(await readXrc137RuleJson(ruleAddress));
        } catch (error) {
          ruleWarnings.push(`XRC137.getRule() eth_call failed or could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const usage = includeUsage && ruleAddress && hasXrcDb() ? await safeDb(() => getXrcUsageDb({ address: ruleAddress, type: 'xrc137', limit: 5 })) : null;
      if (!ruleAddress) ruleWarnings.push('No deployed XRC-137 rule address found on this step.');
      return {
        stepId,
        ruleAddress,
        xrc137,
        rule,
        onValid: step.onValid ?? step.on_valid ?? null,
        onInvalid: step.onInvalid ?? step.on_invalid ?? null,
        usage: usage && usage.ok ? usage.value : undefined,
        warnings: ruleWarnings
      };
    }));
    const edges = steps.flatMap((step) => [
      step.onValid ? { from: step.stepId, branch: 'onValid' as const, to: step.onValid } : null,
      step.onInvalid ? { from: step.stepId, branch: 'onInvalid' as const, to: step.onInvalid } : null
    ].filter(Boolean));
    return textJson({
      graphStatus: rawSteps.length > 0 ? 'resolved' : 'metadata_only',
      ostcJsonSource,
      xrc729: contractResult.contract,
      ostc: chosen,
      steps,
      edges,
      unresolvedRules: [...new Set(unresolvedRules)],
      warnings: [...warnings, contractResult.warning, ostcResult.warning].filter(Boolean)
    });
  });

  server.registerTool('get_xrc_usage', {
    title: 'Get XRC session usage',
    description: 'Read-only usage statistics from Explorer PGRO tx_receipts for XRC-137 rules or XRC-729 OSTC/process filters.',
    inputSchema: { address: addressSchema, type: xrcTypeSchema.optional(), ostcId: z.string().min(1).optional(), ostcHash: z.string().min(1).optional(), windowHours: windowHoursSchema, limit: limitSchema }
  }, async ({ address, type, ostcId, ostcHash, windowHours, limit }) => {
    if (type === 'xrc729' && !ostcId && !ostcHash) {
      return textJson({ address, type, usageKnown: false, usageStatus: 'not_linkable_without_ostc', suggestion: 'Provide ostcId or ostcHash, or call resolve_xrc729_process_graph first to choose an indexed OSTC.' });
    }
    const db = await safeDb(() => getXrcUsageDb({ address, type, ostcId, ostcHash, windowHours, limit }));
    return textJson(db.ok ? { address, type: type ?? 'xrc137', ...db.value } : { address, type, usageKnown: false, warning: db.message });
  });

  server.registerTool('list_xrc_process_sessions', {
    title: 'List XRC process sessions',
    description: 'Read-only list of sessions associated with an XRC-729 OSTC id/hash.',
    inputSchema: { xrc729Address: addressSchema.optional(), ostcId: z.string().min(1).optional(), ostcHash: z.string().min(1).optional(), owner: addressSchema.optional(), windowHours: windowHoursSchema, page: pageSchema, limit: limitSchema }
  }, async (input) => {
    if (!input.ostcId && !input.ostcHash) {
      return textJson({ error: 'insufficient_filters', message: 'Provide one of ostcId or ostcHash. If xrc729Address is supplied, combine it with ostcId or ostcHash.' });
    }
    const db = await safeDb(() => listXrcProcessSessionsDb(input));
    return textJson(db.ok ? { source: 'explorer_db', sessions: db.value } : { source: 'unavailable', sessions: [], warning: db.message });
  });

  server.registerTool('find_reusable_xrc137_rules', {
    title: 'Find reusable XRC-137 rules',
    description: 'Read-only metadata-assisted search for existing owner XRC-137 contracts that could be reused instead of redeployed.',
    inputSchema: {
      owner: addressSchema,
      draftRule: z.record(z.string(), z.unknown()).optional(),
      ruleHash: z.string().min(1).optional(),
      requiredInputKeys: z.array(z.string()).optional(),
      requiredOutputKeys: z.array(z.string()).optional(),
      allowEncrypted: z.boolean().optional(),
      includeUsage: z.boolean().optional(),
      limit: limitSchema
    }
  }, async ({ owner, draftRule, ruleHash, requiredInputKeys = [], requiredOutputKeys = [], allowEncrypted = false, includeUsage = false, limit }) => {
    const max = normalizeXrcLimit(limit);
    const contractsResult = await explorerOrDbListContracts({ owner, type: 'xrc137', limit: 200 });
    const draftKeys = extractKeys(draftRule);
    const desiredInputs = [...new Set([...requiredInputKeys, ...draftKeys])];
    const desiredOutputs = [...new Set(requiredOutputKeys)];
    const candidates = await Promise.all(contractsResult.contracts.map(async (contract) => {
      const encrypted = contract.encryptedState === true;
      let matchType: 'exact_hash' | 'semantic_shape' | 'partial_shape' | 'encrypted_metadata_only' | null = null;
      let score = 0;
      let reason = '';
      if (ruleHash && contract.ruleHash === ruleHash) {
        matchType = 'exact_hash';
        score = 100;
        reason = 'Indexed ruleHash matches the requested ruleHash.';
      } else if (encrypted && !allowEncrypted) {
        matchType = 'encrypted_metadata_only';
        score = 10;
        reason = 'Rule is encrypted; semantic comparison is not possible without external decryption.';
      } else if (desiredInputs.length > 0 || desiredOutputs.length > 0) {
        matchType = 'partial_shape';
        score = 25;
        reason = 'Only indexed metadata is used by this candidate search, so this is a weak shape candidate; call read_xrc137_rule_json for runtime rule JSON when needed.';
      }
      if (!matchType) return null;
      const contractAddress = typeof contract.contractAddress === 'string' ? contract.contractAddress : '';
      const usage = includeUsage && hasXrcDb() && contractAddress
        ? await safeDb(() => getXrcUsageDb({ address: contractAddress, type: 'xrc137', limit: 5 }))
        : null;
      return { contractAddress: contract.contractAddress, matchType, score, reason, contract, usage: usage && usage.ok ? usage.value : undefined };
    }));
    return textJson({
      source: contractsResult.source,
      requestedShape: { inputKeys: desiredInputs, outputKeys: desiredOutputs, inputOverlapAvailable: overlap(desiredInputs, desiredInputs), outputOverlapAvailable: overlap(desiredOutputs, desiredOutputs) },
      candidates: candidates.filter(Boolean).sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0)).slice(0, max),
      warnings: [contractsResult.warning, 'Semantic reuse checks in this tool are limited to indexed metadata and ruleHash; use read_xrc137_rule_json to inspect runtime rule JSON for a candidate.'].filter(Boolean)
    });
  });

  server.registerTool('get_unused_xrc137_rules', {
    title: 'Get unused XRC-137 rules',
    description: 'Read-only list of owner XRC-137 rules with no observed tx_receipts engine_rule_contract usage.',
    inputSchema: { owner: addressSchema, limit: limitSchema }
  }, async ({ owner, limit }) => {
    const db = await safeDb(() => listUnusedXrc137RulesDb(owner, limit));
    return textJson(db.ok ? { source: 'explorer_db', rules: db.value } : { source: 'unavailable', rules: [], warning: db.message });
  });

  server.registerTool('get_xrc_failure_stats', {
    title: 'Get XRC failure stats',
    description: 'Read-only invalid/failure statistics associated with an XRC-137 rule or XRC-729 OSTC/process filters.',
    inputSchema: { address: addressSchema.optional(), type: xrcTypeSchema.optional(), ostcId: z.string().min(1).optional(), ostcHash: z.string().min(1).optional(), owner: addressSchema.optional(), windowHours: windowHoursSchema, limit: limitSchema }
  }, async (input) => {
    const db = await safeDb(() => getXrcFailureStatsDb(input));
    return textJson(db.ok ? { source: 'explorer_db', ...db.value } : { source: 'unavailable', warning: db.message });
  });
}
