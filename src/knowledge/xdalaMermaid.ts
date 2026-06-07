import { readXrc137RuleJson, readXrc729OstcJson } from '../adapters/contractReadClient.js';
import { validateXgrMultiBundle, type Issue } from './multiBundle.js';

export type XdalaMermaidSource = 'runtime' | 'bundle' | 'bundle_handoff';
export type XdalaMermaidDirection = 'TD' | 'LR';
export type XdalaMermaidBranch = 'onValid' | 'onInvalid' | 'join' | 'wakeUp';

export type XdalaMermaidWarning = {
  code: string;
  message: string;
  stepId?: string;
  path?: string;
};

export type XdalaMermaidNode = {
  id: string;
  label: string;
  ruleRef?: string;
  ruleAddress?: string;
  requiredPayload?: string[];
  producedPayload?: string[];
};

export type XdalaMermaidEdge = {
  from: string;
  to: string;
  branch: XdalaMermaidBranch;
  label: string;
};

export type XdalaMermaidOptions = {
  direction?: XdalaMermaidDirection;
  includeRules?: boolean;
  includeAddresses?: boolean;
  includeRuleSummary?: boolean;
  includePayloadFields?: boolean;
  includeWarnings?: boolean;
};

export type XdalaMermaidResult = {
  source: XdalaMermaidSource;
  sourceTruth: 'runtime' | 'authoring';
  mermaid: string;
  nodes: XdalaMermaidNode[];
  edges: XdalaMermaidEdge[];
  warnings: XdalaMermaidWarning[];
};

type JsonMap = Record<string, unknown>;
type NormalizedStep = {
  id: string;
  ruleRef?: string;
  ruleAddress?: string;
  ruleAlias?: string;
  ruleJson?: unknown;
  onValid?: unknown;
  onInvalid?: unknown;
};

type RuleSummary = {
  alias?: string;
  address?: string;
  requiredPayload?: string[];
  producedPayload?: string[];
  wakeUps?: Array<{ branch: 'onValid' | 'onInvalid'; stepId: string }>;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CM_XRC137_RE = /^cm:xrc137:(.+)$/;

function isMap(value: unknown): value is JsonMap {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractSteps(ostcJson: unknown): NormalizedStep[] {
  const parsed = parseMaybeJson(ostcJson);
  if (!isMap(parsed)) return [];
  const candidates = [
    parsed.steps,
    Array.isArray(parsed.structure) || isMap(parsed.structure) ? parsed.structure : undefined,
    isMap(parsed.structure) ? parsed.structure.steps : undefined
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isMap).map((step, index) => normalizeStep(String(step.id ?? step.stepId ?? step.step_id ?? `step_${index}`), step));
    }
    if (isMap(candidate)) {
      return Object.entries(candidate).map(([id, value]) => normalizeStep(id, isMap(value) ? value : {}));
    }
  }
  return [];
}

function normalizeStep(id: string, step: JsonMap): NormalizedStep {
  const rule = step.rule ?? step.ruleAddress ?? step.xrc137 ?? step.rule_contract;
  let ruleRef = stringValue(rule);
  let ruleAddress = ruleRef && ADDRESS_RE.test(ruleRef) ? ruleRef : undefined;
  if (isMap(rule)) {
    ruleRef = stringValue(rule.address) ?? stringValue(rule.contractAddress) ?? stringValue(rule.contract_address);
    ruleAddress = ruleRef && ADDRESS_RE.test(ruleRef) ? ruleRef : undefined;
  }
  return {
    id,
    ruleRef,
    ruleAddress,
    onValid: step.onValid ?? step.on_valid,
    onInvalid: step.onInvalid ?? step.on_invalid
  };
}

function branchObject(value: unknown): JsonMap | null {
  if (isMap(value)) return value;
  if (typeof value === 'string') return { spawns: [value] };
  if (Array.isArray(value)) return { spawns: value };
  return null;
}

function keysOfMap(value: unknown): string[] {
  return isMap(value) ? Object.keys(value).sort() : [];
}

function requiredPayloadKeys(payload: unknown): string[] | undefined {
  if (!isMap(payload)) return undefined;
  const keys = Object.entries(payload)
    .filter(([, spec]) => isMap(spec) && !Object.prototype.hasOwnProperty.call(spec, 'default'))
    .map(([field]) => field)
    .sort();
  return keys.length > 0 ? keys : undefined;
}

function ruleSummary(rule: unknown, fallbackAlias?: string, fallbackAddress?: string): RuleSummary {
  const parsed = parseMaybeJson(rule);
  const alias = isMap(parsed)
    ? stringValue((isMap(parsed.meta) ? parsed.meta.alias : undefined) ?? parsed.alias ?? parsed.name ?? parsed.contractId ?? parsed.id) ?? fallbackAlias
    : fallbackAlias;
  const requiredPayload = isMap(parsed) ? requiredPayloadKeys(parsed.payload) : undefined;
  const validPayload = isMap(parsed) && isMap(parsed.onValid) ? keysOfMap(parsed.onValid.payload) : [];
  const invalidPayload = isMap(parsed) && isMap(parsed.onInvalid) ? keysOfMap(parsed.onInvalid.payload) : [];
  const producedPayload = [...new Set([...validPayload, ...invalidPayload])].sort();
  const wakeUps: RuleSummary['wakeUps'] = [];
  if (isMap(parsed)) {
    for (const branch of ['onValid', 'onInvalid'] as const) {
      const branchData = parsed[branch];
      if (!isMap(branchData) || !Array.isArray(branchData.wakeUps)) continue;
      for (const wakeUp of branchData.wakeUps) {
        if (isMap(wakeUp) && typeof wakeUp.stepId === 'string') wakeUps.push({ branch, stepId: wakeUp.stepId });
      }
    }
  }
  return {
    alias,
    address: fallbackAddress,
    requiredPayload: requiredPayload && requiredPayload.length > 0 ? requiredPayload : undefined,
    producedPayload: producedPayload.length > 0 ? producedPayload : undefined,
    wakeUps
  };
}

function shortRef(value: string): string {
  if (ADDRESS_RE.test(value)) return `${value.slice(0, 6)}...${value.slice(-4)}`;
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

function mermaidId(original: string, used: Set<string>): string {
  let id = original.replace(/[^A-Za-z0-9_]/g, '_');
  if (!id) id = 'node';
  if (/^[0-9]/.test(id)) id = `n_${id}`;
  let candidate = id;
  let index = 2;
  while (used.has(candidate)) candidate = `${id}_${index++}`;
  used.add(candidate);
  return candidate;
}

function escapeLabel(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br/>');
}

function edgeLabel(value: string): string {
  return value.replace(/\|/g, '/').replace(/\r?\n/g, ' ');
}

function modeLabel(mode: unknown): string {
  if (typeof mode === 'string') return mode;
  if (isMap(mode)) {
    if (typeof mode.kofn === 'number') return `kofn:${mode.kofn}`;
    if (typeof mode.k === 'number') return `kofn:${mode.k}`;
  }
  return 'all';
}

function collectBundle(bundleInput: Record<string, unknown>, warnings: XdalaMermaidWarning[]): { steps: NormalizedStep[]; rules: Map<string, RuleSummary> } {
  const bundles = Array.isArray(bundleInput.bundles) ? bundleInput.bundles.filter(isMap) : [];
  if (bundles.length === 0) {
    warnings.push({ code: 'MISSING_BUNDLE', message: 'MultiBundle has no renderable bundles.', path: 'bundles' });
    return { steps: [], rules: new Map() };
  }
  if (bundles.length > 1) warnings.push({ code: 'MULTIPLE_BUNDLES_RENDERED_FIRST_ONLY', message: 'Multiple bundles were supplied; rendering the first bundle only.', path: 'bundles' });
  const first = bundles[0];
  const items = Array.isArray(first.items) ? first.items.filter(isMap) : [];
  const xrc729 = items.find((item) => isMap(item.meta) && item.meta.type === 'xrc729');
  const xrc137Items = items.filter((item) => isMap(item.meta) && item.meta.type === 'xrc137');
  if (!xrc729) {
    warnings.push({ code: 'MISSING_BUNDLE', message: 'The selected bundle does not contain an XRC-729 item.', path: 'bundles.0.items' });
    return { steps: [], rules: new Map() };
  }
  const rules = new Map<string, RuleSummary>();
  for (const item of xrc137Items) {
    const alias = isMap(item.meta) ? stringValue(item.meta.alias) : undefined;
    if (!alias) continue;
    const address = stringValue(item.address) ?? (isMap(item.meta) ? stringValue(item.meta.deployedAddress) : undefined);
    rules.set(alias, ruleSummary(item, alias, address));
  }
  const steps = extractSteps({ structure: xrc729.structure }).map((step) => {
    const alias = step.ruleRef?.match(CM_XRC137_RE)?.[1];
    return { ...step, ruleAlias: alias };
  });
  return { steps, rules };
}

export function validateBundleForMermaid(bundle: unknown): { ok: true } | { ok: false; validation: ReturnType<typeof validateXgrMultiBundle> } {
  const validation = validateXgrMultiBundle(bundle);
  return validation.valid ? { ok: true } : { ok: false, validation };
}

export function renderBundleMermaid(source: XdalaMermaidSource, bundleInput: Record<string, unknown>, options: XdalaMermaidOptions = {}): XdalaMermaidResult {
  const warnings: XdalaMermaidWarning[] = [];
  const { steps, rules } = collectBundle(bundleInput, warnings);
  return renderSteps(source, 'authoring', steps, rules, warnings, options);
}

export async function renderRuntimeMermaid(input: { xrc729Address: string; ostcId: string }, options: XdalaMermaidOptions = {}): Promise<XdalaMermaidResult> {
  const warnings: XdalaMermaidWarning[] = [];
  let ostcJson: unknown = null;
  try {
    ostcJson = parseMaybeJson(await readXrc729OstcJson(input.xrc729Address, input.ostcId));
  } catch (error) {
    warnings.push({ code: 'MISSING_BUNDLE', message: `XRC729.getOSTC(${input.ostcId}) failed or could not be decoded: ${error instanceof Error ? error.message : String(error)}` });
  }
  const steps = extractSteps(ostcJson);
  const rules = new Map<string, RuleSummary>();
  if (options.includeRules !== false) {
    await Promise.all(steps.map(async (step) => {
      if (!step.ruleAddress) {
        warnings.push({ code: 'UNRESOLVED_RULE', message: 'No deployed XRC-137 rule address found on this step.', stepId: step.id });
        return;
      }
      try {
        const ruleJson = parseMaybeJson(await readXrc137RuleJson(step.ruleAddress));
        step.ruleJson = ruleJson;
        rules.set(step.ruleAddress, ruleSummary(ruleJson, undefined, step.ruleAddress));
      } catch (error) {
        warnings.push({ code: 'UNRESOLVED_RULE', message: `XRC137.getRule() failed or could not be decoded for ${step.ruleAddress}: ${error instanceof Error ? error.message : String(error)}`, stepId: step.id });
      }
    }));
  }
  return renderSteps('runtime', 'runtime', steps, rules, warnings, options);
}

function renderSteps(
  source: XdalaMermaidSource,
  sourceTruth: 'runtime' | 'authoring',
  steps: NormalizedStep[],
  rules: Map<string, RuleSummary>,
  warnings: XdalaMermaidWarning[],
  options: XdalaMermaidOptions
): XdalaMermaidResult {
  const direction = options.direction ?? 'LR';
  const stepIds = new Set(steps.map((step) => step.id));
  const usedMermaidIds = new Set<string>();
  const idMap = new Map<string, string>();
  for (const step of steps) idMap.set(step.id, mermaidId(step.id, usedMermaidIds));

  const nodes: XdalaMermaidNode[] = steps.map((step) => {
    const summaryKey = step.ruleAlias ?? step.ruleAddress ?? step.ruleRef ?? '';
    const summary = rules.get(summaryKey) ?? (step.ruleJson ? ruleSummary(step.ruleJson, step.ruleAlias, step.ruleAddress) : undefined);
    if (step.ruleAlias && !summary) warnings.push({ code: 'UNRESOLVED_RULE', message: `Rule alias ${step.ruleAlias} did not resolve to an XRC-137 item in the selected bundle.`, stepId: step.id });
    if (options.includeRuleSummary !== false && !summary && step.ruleRef) warnings.push({ code: 'RULE_SUMMARY_UNAVAILABLE', message: `Rule summary is unavailable for ${step.ruleRef}.`, stepId: step.id });
    const ruleDisplay = summary?.alias ?? step.ruleAlias ?? (step.ruleRef ? shortRef(step.ruleRef) : undefined);
    const parts = [step.id];
    if (options.includeRuleSummary !== false && ruleDisplay) parts.push(`Rule: ${ruleDisplay}`);
    if (options.includeAddresses && (summary?.address ?? step.ruleAddress)) parts.push(`Address: ${shortRef(summary?.address ?? step.ruleAddress ?? '')}`);
    if (options.includePayloadFields) {
      if (summary?.requiredPayload?.length) parts.push(`Requires: ${summary.requiredPayload.join(', ')}`);
      if (summary?.producedPayload?.length) parts.push(`Produces: ${summary.producedPayload.join(', ')}`);
    }
    return {
      id: step.id,
      label: parts.join('\n'),
      ruleRef: step.ruleRef,
      ruleAddress: summary?.address ?? step.ruleAddress,
      requiredPayload: summary?.requiredPayload,
      producedPayload: summary?.producedPayload
    };
  });

  const edges: XdalaMermaidEdge[] = [];
  const joinLines: string[] = [];
  let joinIndex = 0;
  const addEdge = (from: string, to: string, branch: XdalaMermaidBranch, label: string, path?: string): void => {
    if (!stepIds.has(to) && !to.startsWith('__join_')) warnings.push({ code: 'UNKNOWN_STEP_TARGET', message: `Step target ${to} does not exist.`, stepId: from, path });
    edges.push({ from, to, branch, label });
  };

  for (const step of steps) {
    for (const branchName of ['onValid', 'onInvalid'] as const) {
      const branch = branchObject(step[branchName]);
      if (!branch) continue;
      if (branch.spawns !== undefined && !Array.isArray(branch.spawns)) {
        warnings.push({ code: 'INVALID_BRANCH', message: `${branchName}.spawns must be an array.`, stepId: step.id });
      }
      if (Array.isArray(branch.spawns)) {
        for (const target of branch.spawns) {
          if (typeof target !== 'string' || !target) {
            warnings.push({ code: 'INVALID_BRANCH', message: `${branchName}.spawns contains a non-string target.`, stepId: step.id });
            continue;
          }
          addEdge(step.id, target, branchName, branchName, `${step.id}.${branchName}.spawns`);
        }
      }
      if (branch.join !== undefined) {
        if (!isMap(branch.join) || typeof branch.join.joinid !== 'string') {
          warnings.push({ code: 'INVALID_JOIN', message: `${branchName}.join must be an object with joinid.`, stepId: step.id });
          continue;
        }
        const joinId = `__join_${++joinIndex}_${step.id}_${branchName}`;
        const joinMermaidId = mermaidId(joinId, usedMermaidIds);
        idMap.set(joinId, joinMermaidId);
        const joinTarget = branch.join.joinid;
        const mode = modeLabel(branch.join.mode);
        joinLines.push(`  ${joinMermaidId}((${escapeLabel(`join: ${mode}${joinTarget ? `\n${joinTarget}` : ''}`)}))`);
        const joinFrom = Array.isArray(branch.join.from) ? branch.join.from : [];
        if (joinFrom.length === 0) addEdge(step.id, joinId, branchName, branchName, `${step.id}.${branchName}.join`);
        if (joinFrom.length > 0) {
          for (const producer of joinFrom) {
            if (!isMap(producer) || typeof producer.node !== 'string') {
              warnings.push({ code: 'INVALID_JOIN', message: 'join.from entries must contain a node string.', stepId: step.id });
              continue;
            }
            const when = typeof producer.when === 'string' ? producer.when : 'valid';
            addEdge(producer.node, joinId, 'join', when, `${step.id}.${branchName}.join.from`);
          }
        }
        addEdge(joinId, joinTarget, 'join', 'join', `${step.id}.${branchName}.join.joinid`);
      }
    }

    const summaryKey = step.ruleAlias ?? step.ruleAddress ?? step.ruleRef ?? '';
    const summary = rules.get(summaryKey) ?? (step.ruleJson ? ruleSummary(step.ruleJson, step.ruleAlias, step.ruleAddress) : undefined);
    for (const wakeUp of summary?.wakeUps ?? []) {
      if (stepIds.has(wakeUp.stepId)) addEdge(step.id, wakeUp.stepId, 'wakeUp', 'wakeUp', `${step.id}.${wakeUp.branch}.wakeUps`);
      else warnings.push({ code: 'UNKNOWN_STEP_TARGET', message: `Wake-up target ${wakeUp.stepId} does not exist.`, stepId: step.id, path: `${step.id}.${wakeUp.branch}.wakeUps` });
    }
  }

  const lines = [`flowchart ${direction}`];
  if (options.includeWarnings !== false && warnings.length > 0) {
    for (const warning of warnings) lines.push(`  %% ${warning.code}: ${edgeLabel(warning.message)}`);
  }
  for (const node of nodes) {
    const id = idMap.get(node.id) ?? mermaidId(node.id, usedMermaidIds);
    lines.push(`  ${id}["${escapeLabel(node.label)}"]`);
  }
  lines.push(...joinLines);
  for (const edge of edges) {
    const from = idMap.get(edge.from) ?? mermaidId(edge.from, usedMermaidIds);
    const to = idMap.get(edge.to) ?? mermaidId(edge.to, usedMermaidIds);
    lines.push(`  ${from} -->|${edgeLabel(edge.label)}| ${to}`);
  }

  return { source, sourceTruth, mermaid: lines.join('\n'), nodes, edges, warnings };
}

export function validationErrorsAsWarnings(errors: Issue[]): XdalaMermaidWarning[] {
  return errors.map((issue) => ({ code: issue.code, message: issue.message, path: issue.path }));
}
