type JsonMap = Record<string, unknown>;

type ValidationIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
};

type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  flow?: Record<string, string[]>;
};

type BranchName = 'onValid' | 'onInvalid';

const identRe = /^[A-Za-z][A-Za-z0-9_]*$/;
const forbiddenPlaceholderPatterns = [
  { code: 'DOLLAR_INPUT_PLACEHOLDER', pattern: new RegExp('\\$input\\.'), label: 'dollar-input placeholder syntax' },
  { code: 'DOLLAR_API_PLACEHOLDER', pattern: new RegExp('\\$api\\.'), label: 'dollar-api placeholder syntax' },
  { code: 'DOLLAR_BRACE_PLACEHOLDER', pattern: new RegExp('\\$\\{[^}]+\\}'), label: 'dollar-brace placeholder syntax' }
];

function isMap(value: unknown): value is JsonMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysOf(value: unknown): string[] {
  return isMap(value) ? Object.keys(value) : [];
}

function requiredPayloadKeys(rule: unknown): string[] {
  if (!isMap(rule) || !isMap(rule.payload)) {
    return [];
  }

  return Object.entries(rule.payload)
    .filter(([, spec]) => isMap(spec) && !Object.prototype.hasOwnProperty.call(spec, 'default'))
    .map(([key]) => key)
    .sort();
}

function branchOutputKeys(rule: unknown, branch: BranchName): string[] {
  if (!isMap(rule) || !isMap(rule[branch])) {
    return [];
  }

  return keysOf(rule[branch].payload).sort();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function addIssue(target: ValidationIssue[], level: ValidationIssue['level'], code: string, message: string, path?: string): void {
  target.push({ level, code, message, path });
}

function joinModeThreshold(mode: unknown, inputCount: number): number {
  if (typeof mode === 'string') {
    const normalized = mode.trim().toLowerCase();
    if (normalized === 'all') return inputCount;
    if (normalized === 'any') return 1;
  }

  if (isMap(mode)) {
    const raw = typeof mode.kofn === 'number' ? mode.kofn : mode.k;
    if (typeof raw === 'number' && Number.isInteger(raw)) {
      return raw;
    }
  }

  return 1;
}

function merge(a: Set<string>, b: Iterable<string>): Set<string> {
  const out = new Set(a);
  for (const item of b) out.add(item);
  return out;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function scanStrings(value: unknown, visit: (text: string, path: string) => void, path = '$'): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStrings(item, visit, `${path}.${index}`));
    return;
  }

  if (isMap(value)) {
    for (const [key, item] of Object.entries(value)) {
      scanStrings(item, visit, `${path}.${key}`);
    }
  }
}

function scanForbiddenPlaceholders(value: unknown, issues: ValidationIssue[], pathPrefix = '$'): void {
  scanStrings(value, (text, path) => {
    for (const forbidden of forbiddenPlaceholderPatterns) {
      if (forbidden.pattern.test(text)) {
        addIssue(
          issues,
          'error',
          forbidden.code,
          `Invalid ${forbidden.label}; use bracket placeholders such as [fieldName].`,
          path.startsWith('$') ? path : `${pathPrefix}.${path}`
        );
      }
    }
  }, pathPrefix);
}

function validatePayloadSchema(rule: JsonMap, errors: ValidationIssue[]): void {
  if (!isMap(rule.payload)) {
    addIssue(errors, 'error', 'PAYLOAD_NOT_OBJECT', 'XRC-137 payload must be an object input schema.', 'payload');
    return;
  }

  for (const [field, spec] of Object.entries(rule.payload)) {
    const path = `payload.${field}`;
    if (!isMap(spec)) {
      addIssue(errors, 'error', 'PAYLOAD_FIELD_NOT_OBJECT', `Payload field ${field} must be an object schema.`, path);
      continue;
    }

    if (typeof spec.type !== 'string' || spec.type.trim() === '') {
      addIssue(errors, 'error', 'PAYLOAD_FIELD_TYPE_MISSING', `Payload field ${field} requires a non-empty type.`, `${path}.type`);
    }

    for (const key of Object.keys(spec)) {
      if (!['type', 'default'].includes(key)) {
        addIssue(errors, 'error', 'PAYLOAD_FIELD_KEY_INVALID', `Payload field ${field} may only contain type and default. Found ${key}.`, `${path}.${key}`);
      }
    }
  }
}

function validateApiCalls(rule: JsonMap, errors: ValidationIssue[], warnings: ValidationIssue[]): void {
  if (rule.apiCalls === undefined) return;
  if (!Array.isArray(rule.apiCalls)) {
    addIssue(errors, 'error', 'APICALLS_NOT_ARRAY', 'apiCalls must be an array.', 'apiCalls');
    return;
  }

  rule.apiCalls.forEach((call, index) => {
    const path = `apiCalls.${index}`;
    if (!isMap(call)) {
      addIssue(errors, 'error', 'APICALL_NOT_OBJECT', `apiCalls[${index}] must be an object.`, path);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(call, 'id')) {
      addIssue(errors, 'error', 'APICALL_ID_INVALID', 'apiCalls use name, not id.', `${path}.id`);
    }
    if (Object.prototype.hasOwnProperty.call(call, 'url')) {
      addIssue(errors, 'error', 'APICALL_URL_INVALID', 'apiCalls use urlTemplate, not url.', `${path}.url`);
    }
    if (Object.prototype.hasOwnProperty.call(call, 'extract')) {
      addIssue(errors, 'error', 'APICALL_EXTRACT_INVALID', 'apiCalls use extractMap, not extract.', `${path}.extract`);
    }

    for (const required of ['name', 'method', 'urlTemplate', 'contentType']) {
      if (typeof call[required] !== 'string' || String(call[required]).trim() === '') {
        addIssue(errors, 'error', 'APICALL_REQUIRED_FIELD_MISSING', `apiCalls[${index}] requires ${required}.`, `${path}.${required}`);
      }
    }

    if (call.extractMap !== undefined) {
      if (!isMap(call.extractMap)) {
        addIssue(errors, 'error', 'EXTRACTMAP_NOT_OBJECT', `apiCalls[${index}].extractMap must be an object.`, `${path}.extractMap`);
      } else {
        for (const [alias, spec] of Object.entries(call.extractMap)) {
          const aliasPath = `${path}.extractMap.${alias}`;
          if (!isMap(spec)) {
            addIssue(errors, 'error', 'EXTRACTMAP_FIELD_NOT_OBJECT', `extractMap.${alias} must be a TypedValue object.`, aliasPath);
            continue;
          }
          if (typeof spec.type !== 'string' || spec.type.trim() === '') {
            addIssue(errors, 'error', 'EXTRACTMAP_TYPE_MISSING', `extractMap.${alias} requires type.`, `${aliasPath}.type`);
          }
          if (!Object.prototype.hasOwnProperty.call(spec, 'value')) {
            addIssue(warnings, 'warning', 'EXTRACTMAP_VALUE_MISSING', `extractMap.${alias} usually requires value.`, `${aliasPath}.value`);
          }
        }
      }
    }
  });
}

function validateRules(rule: JsonMap, errors: ValidationIssue[]): void {
  if (!Array.isArray(rule.rules)) {
    addIssue(errors, 'error', 'RULES_NOT_ARRAY', 'rules must be an array.', 'rules');
    return;
  }

  rule.rules.forEach((item, index) => {
    const path = `rules.${index}`;
    if (typeof item === 'string') return;
    if (!isMap(item)) {
      addIssue(errors, 'error', 'RULE_INVALID', `rules[${index}] must be a string or an object.`, path);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(item, 'id')) {
      addIssue(errors, 'error', 'RULE_ID_INVALID', 'Rule objects do not use id.', `${path}.id`);
    }
    if (Object.prototype.hasOwnProperty.call(item, 'expr')) {
      addIssue(errors, 'error', 'RULE_EXPR_INVALID', 'Rule objects use expression, not expr.', `${path}.expr`);
    }
    if (typeof item.expression !== 'string' || item.expression.trim() === '') {
      addIssue(errors, 'error', 'RULE_EXPRESSION_MISSING', 'Rule object requires a non-empty expression.', `${path}.expression`);
    }
    if (item.type !== undefined && !['validate', 'abortStep', 'cancelSession'].includes(String(item.type))) {
      addIssue(errors, 'error', 'RULE_TYPE_INVALID', 'Rule type must be validate, abortStep or cancelSession.', `${path}.type`);
    }
  });
}

export function validateXrc137Authoring(rule: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!isMap(rule)) {
    addIssue(errors, 'error', 'RULE_NOT_OBJECT', 'XRC-137 rule must be a JSON object.');
    return { valid: false, errors, warnings };
  }

  validatePayloadSchema(rule, errors);
  validateApiCalls(rule, errors, warnings);
  validateRules(rule, errors);
  scanForbiddenPlaceholders(rule, errors);

  for (const branchName of ['onValid', 'onInvalid'] as const) {
    const branch = rule[branchName];
    if (!isMap(branch)) {
      addIssue(errors, 'error', 'BRANCH_MISSING_OR_INVALID', `${branchName} must be an object.`, branchName);
      continue;
    }
    if (branch.payload !== undefined && !isMap(branch.payload)) {
      addIssue(errors, 'error', 'BRANCH_PAYLOAD_NOT_OBJECT', `${branchName}.payload must be an object output payload.`, `${branchName}.payload`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateXDaLaBlueprint(input: {
  ostc: unknown;
  xrc137ByStep: Record<string, unknown>;
  entryStepId: string;
  initialPayloadFields?: string[];
}): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const flow: Record<string, string[]> = {};

  const initialFields = new Set(input.initialPayloadFields ?? []);

  if (!isMap(input.ostc)) {
    addIssue(errors, 'error', 'OSTC_NOT_OBJECT', 'OSTC must be a JSON object.');
    return { valid: false, errors, warnings, flow };
  }

  if (!isMap(input.ostc.structure)) {
    addIssue(errors, 'error', 'STRUCTURE_MISSING', 'OSTC.structure must be an object.');
    return { valid: false, errors, warnings, flow };
  }

  const steps = input.ostc.structure as Record<string, unknown>;
  const stepIds = Object.keys(steps);
  const stepSet = new Set(stepIds);

  if (!stepSet.has(input.entryStepId)) {
    addIssue(errors, 'error', 'ENTRY_STEP_UNKNOWN', `Entry step ${input.entryStepId} does not exist in OSTC.structure.`, 'entryStepId');
  }

  for (const stepId of stepIds) {
    if (!identRe.test(stepId)) {
      addIssue(errors, 'error', 'INVALID_STEP_ID', `Step id ${stepId} is not a valid ASCII identifier.`, `structure.${stepId}`);
    }

    const step = steps[stepId];
    if (!isMap(step)) {
      addIssue(errors, 'error', 'STEP_NOT_OBJECT', `Step ${stepId} must be an object.`, `structure.${stepId}`);
      continue;
    }

    if (typeof step.rule !== 'string' || step.rule.trim() === '') {
      addIssue(errors, 'error', 'STEP_RULE_MISSING', `Step ${stepId} must define a non-empty rule reference.`, `structure.${stepId}.rule`);
    }

    if (!Object.prototype.hasOwnProperty.call(input.xrc137ByStep, stepId)) {
      addIssue(warnings, 'warning', 'RULE_DRAFT_MISSING', `No XRC-137 draft was provided for step ${stepId}; payload-flow validation for this step is incomplete.`, `xrc137ByStep.${stepId}`);
    }

    for (const branchName of ['onValid', 'onInvalid'] as const) {
      const branch = step[branchName];
      if (branch === undefined) continue;
      if (!isMap(branch)) {
        addIssue(errors, 'error', 'BRANCH_NOT_OBJECT', `${stepId}.${branchName} must be an object.`, `structure.${stepId}.${branchName}`);
        continue;
      }

      for (const target of asStringArray(branch.spawns)) {
        if (!stepSet.has(target)) {
          addIssue(errors, 'error', 'SPAWN_TARGET_UNKNOWN', `${stepId}.${branchName} spawns unknown step ${target}.`, `structure.${stepId}.${branchName}.spawns`);
        }
      }

      if (branch.join !== undefined) {
        if (!isMap(branch.join)) {
          addIssue(errors, 'error', 'JOIN_NOT_OBJECT', `${stepId}.${branchName}.join must be an object.`, `structure.${stepId}.${branchName}.join`);
          continue;
        }

        const join = branch.join;
        if (typeof join.joinid !== 'string' || join.joinid.trim() === '') {
          addIssue(errors, 'error', 'JOIN_ID_MISSING', `${stepId}.${branchName}.join requires joinid.`, `structure.${stepId}.${branchName}.join.joinid`);
        } else if (!stepSet.has(join.joinid)) {
          addIssue(errors, 'error', 'JOIN_TARGET_UNKNOWN', `${stepId}.${branchName}.joinid references unknown step ${join.joinid}.`, `structure.${stepId}.${branchName}.join.joinid`);
        }

        const from = Array.isArray(join.from) ? join.from : [];
        if (from.length === 0) {
          addIssue(errors, 'error', 'JOIN_FROM_EMPTY', `${stepId}.${branchName}.join.from must list producer nodes.`, `structure.${stepId}.${branchName}.join.from`);
        }

        for (const [index, item] of from.entries()) {
          if (!isMap(item) || typeof item.node !== 'string') {
            addIssue(errors, 'error', 'JOIN_FROM_INVALID', `${stepId}.${branchName}.join.from[${index}] must contain node.`, `structure.${stepId}.${branchName}.join.from.${index}`);
            continue;
          }
          if (!stepSet.has(item.node)) {
            addIssue(errors, 'error', 'JOIN_FROM_UNKNOWN', `${stepId}.${branchName}.join.from references unknown producer ${item.node}.`, `structure.${stepId}.${branchName}.join.from.${index}.node`);
          }
          const when = typeof item.when === 'string' ? item.when.toLowerCase() : 'any';
          if (!['valid', 'invalid', 'any', 'both'].includes(when)) {
            addIssue(errors, 'error', 'JOIN_WHEN_INVALID', `${stepId}.${branchName}.join.from[${index}].when must be valid, invalid, any or both.`, `structure.${stepId}.${branchName}.join.from.${index}.when`);
          }
        }

        const k = joinModeThreshold(join.mode, from.length);
        if (k < 1 || k > from.length) {
          addIssue(errors, 'error', 'JOIN_THRESHOLD_INVALID', `${stepId}.${branchName}.join mode threshold ${k} is outside [1..${from.length}].`, `structure.${stepId}.${branchName}.join.mode`);
        }

        const wait = typeof join.waitonjoin === 'string' ? join.waitonjoin.toLowerCase() : 'drain';
        if (!['drain', 'kill'].includes(wait)) {
          addIssue(errors, 'error', 'JOIN_WAIT_INVALID', `${stepId}.${branchName}.join.waitonjoin must be drain or kill.`, `structure.${stepId}.${branchName}.join.waitonjoin`);
        }
      }
    }
  }

  const availableByStep = new Map<string, Set<string>>();
  if (stepSet.has(input.entryStepId)) {
    availableByStep.set(input.entryStepId, initialFields);
  }

  let changed = true;
  let guard = 0;
  while (changed && guard++ < stepIds.length * 4 + 8) {
    changed = false;

    for (const stepId of stepIds) {
      const step = steps[stepId];
      if (!isMap(step)) continue;
      const current = availableByStep.get(stepId);
      if (!current) continue;
      const rule = input.xrc137ByStep[stepId];

      for (const branchName of ['onValid', 'onInvalid'] as const) {
        const branch = step[branchName];
        if (!isMap(branch)) continue;

        const branchPayload = merge(current, branchOutputKeys(rule, branchName));

        for (const target of asStringArray(branch.spawns)) {
          if (!stepSet.has(target)) continue;
          const old = availableByStep.get(target) ?? new Set<string>();
          const next = merge(old, branchPayload);
          if (!sameSet(old, next)) {
            availableByStep.set(target, next);
            changed = true;
          }
        }

        if (isMap(branch.join) && typeof branch.join.joinid === 'string' && stepSet.has(branch.join.joinid)) {
          let joinedPayload = new Set(branchPayload);
          const from = Array.isArray(branch.join.from) ? branch.join.from : [];
          for (const item of from) {
            if (!isMap(item) || typeof item.node !== 'string') continue;
            const producerRule = input.xrc137ByStep[item.node];
            const when = typeof item.when === 'string' ? item.when.toLowerCase() : 'any';
            if (when === 'valid' || when === 'any' || when === 'both') {
              joinedPayload = merge(joinedPayload, branchOutputKeys(producerRule, 'onValid'));
            }
            if (when === 'invalid' || when === 'any' || when === 'both') {
              joinedPayload = merge(joinedPayload, branchOutputKeys(producerRule, 'onInvalid'));
            }
          }

          const old = availableByStep.get(branch.join.joinid) ?? new Set<string>();
          const next = merge(old, joinedPayload);
          if (!sameSet(old, next)) {
            availableByStep.set(branch.join.joinid, next);
            changed = true;
          }
        }
      }
    }
  }

  for (const stepId of stepIds) {
    const available = availableByStep.get(stepId) ?? new Set<string>();
    flow[stepId] = [...available].sort();

    const required = requiredPayloadKeys(input.xrc137ByStep[stepId]);
    for (const field of required) {
      if (!available.has(field)) {
        const code = stepId === input.entryStepId ? 'ENTRY_INPUT_MISSING' : 'REQUIRED_INPUT_NOT_PROVIDED';
        addIssue(errors, 'error', code, `Step ${stepId} requires payload field ${field}, but no predecessor output or initial input provides it.`, `xrc137ByStep.${stepId}.payload.${field}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, flow };
}
