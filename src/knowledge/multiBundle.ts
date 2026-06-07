type JsonMap = Record<string, unknown>;

export type Issue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
};

export type MultiBundleValidationResult = {
  valid: boolean;
  format: 'xgr-multi-bundle@1';
  errors: Issue[];
  warnings: Issue[];
  bundles: Array<{
    bundleId: string;
    xrc729Id?: string;
    xrc137Aliases: string[];
    placeholders: string[];
    requiredDeployments: string[];
  }>;
};

export type SessionStartValidationResult = {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
};

const FORMAT = 'xgr-multi-bundle@1' as const;
const ALIAS_RE = /^[A-Za-z][A-Za-z0-9_-]{1,127}$/;
const STEP_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RUNNER_PLACEHOLDER_RE = /^\[[A-Za-z][A-Za-z0-9_]*\]$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const XRC_TYPES = [
  'string',
  'bool',
  'int64',
  'uint64',
  'double',
  'decimal',
  'timestamp_ms',
  'duration_ms',
  'uuid',
  'address',
  'bytes',
  'bytes32',
  'uint256',
  'int256'
] as const;
const ALLOWED_TYPES = new Set<string>(XRC_TYPES);
const ROOT_KEYS = new Set(['format', 'createdAt', 'bundles']);
const BUNDLE_KEYS = new Set(['bundleId', 'items']);
const XRC729_KEYS = new Set(['id', 'bundleId', 'meta', 'name', 'address', 'structure']);
const XRC137_KEYS = new Set(['id', 'bundleId', 'address', 'meta', 'name', 'contractId', 'payload', 'apiCalls', 'contractReads', 'rules', 'onValid', 'onInvalid']);
const META_KEYS = new Set(['type', 'alias', 'bundleId', 'version', 'deployedAddress']);
const STEP_KEYS = new Set(['id', 'rule', 'onValid', 'onInvalid']);
const XRC729_BRANCH_KEYS = new Set(['spawns', 'join']);
const JOIN_KEYS = new Set(['joinid', 'mode', 'waitonjoin', 'from']);
const PAYLOAD_FIELD_KEYS = new Set(['type', 'default']);
const RULE_OBJECT_KEYS = new Set(['expression', 'type']);
const XRC137_BRANCH_KEYS = new Set(['waitSec', 'payload', 'execution', 'encryptLogs', 'logExpireDays', 'grants', 'wakeUps']);
const EXECUTION_KEYS = new Set(['to', 'function', 'args', 'value', 'gas', 'extras']);
const GRANT_KEYS = new Set(['address', 'rights', 'expireDays', 'logExpireDays']);
const WAKEUP_KEYS = new Set(['runner', 'sessionId', 'stepId', 'payload']);
const APICALL_KEYS = new Set(['name', 'method', 'urlTemplate', 'contentType', 'headers', 'bodyTemplate', 'timeoutMs', 'extractMap']);
const EXTRACT_SPEC_KEYS = new Set(['type', 'value', 'default', 'save']);
const CONTRACT_READ_KEYS = new Set(['to', 'function', 'args', 'saveAs', 'rpc']);
const SAVE_TARGET_KEYS = new Set(['key', 'type', 'default']);
const TYPED_VALUE_KEYS = new Set(['type', 'value', 'default']);

type ItemKind = 'xrc729' | 'xrc137' | 'unknown';
type BundleSummary = MultiBundleValidationResult['bundles'][number];
type RuleInfo = { required: Set<string>; optional: Set<string>; produced: Set<string>; validProduced: Set<string>; invalidProduced: Set<string> };
type StepInfo = { stepId: string; alias: string; rule: JsonMap; info: RuleInfo };

function objectSchema(properties: JsonMap, required: string[] = []): JsonMap {
  return { type: 'object', additionalProperties: false, required, properties };
}

const typedValueSchema = objectSchema(
  { type: { enum: XRC_TYPES }, value: {}, default: {} },
  ['type', 'value']
);
const ruleObjectSchema = objectSchema(
  { expression: { type: 'string', minLength: 1 }, type: { enum: ['validate', 'abortStep', 'cancelSession'] } },
  ['expression']
);

export const xgrMultiBundleSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'XGR MultiBundle canonical schema package',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'createdAt', 'bundles'],
  properties: {
    format: { const: FORMAT },
    createdAt: { type: 'string', format: 'date-time' },
    bundles: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bundleId', 'items'],
        properties: {
          bundleId: { type: 'string', minLength: 1 },
          items: {
            type: 'array',
            minItems: 2,
            contains: { type: 'object' }
          }
        }
      }
    }
  },
  $defs: {
    xrc729: objectSchema(
      {
        id: { type: 'string', minLength: 1 },
        bundleId: { type: 'string', minLength: 1 },
        meta: objectSchema(
          {
            type: { const: 'xrc729' },
            alias: { type: 'string', pattern: ALIAS_RE.source },
            bundleId: { type: 'string', minLength: 1 },
            version: { type: 'string' },
            deployedAddress: { type: 'string', pattern: EVM_ADDRESS_RE.source }
          },
          ['type', 'alias', 'bundleId']
        ),
        name: { type: 'string' },
        address: { type: 'string', pattern: EVM_ADDRESS_RE.source },
        structure: {
          type: 'object',
          minProperties: 1,
          propertyNames: { pattern: STEP_ID_RE.source },
          additionalProperties: objectSchema(
            {
              id: { type: 'string' },
              rule: { type: 'string', pattern: `^(${EVM_ADDRESS_RE.source.slice(1, -1)}|cm:xrc137:${ALIAS_RE.source.slice(1, -1)})$` },
              onValid: { $ref: '#/$defs/xrc729Branch' },
              onInvalid: { $ref: '#/$defs/xrc729Branch' }
            },
            ['rule']
          )
        }
      },
      ['id', 'bundleId', 'meta', 'structure']
    ),
    xrc729Branch: objectSchema({ spawns: { type: 'array', items: { type: 'string', pattern: STEP_ID_RE.source } }, join: { $ref: '#/$defs/join' } }),
    join: objectSchema(
      {
        joinid: { type: 'string', pattern: STEP_ID_RE.source },
        mode: { anyOf: [{ enum: ['any', 'all'] }, objectSchema({ kofn: { type: 'integer', minimum: 1 } }, ['kofn'])] },
        waitonjoin: { enum: ['drain', 'kill'] },
        from: {
          type: 'array',
          items: objectSchema({ node: { type: 'string', pattern: STEP_ID_RE.source }, when: { enum: ['valid', 'invalid', 'any', 'both'] } }, ['node'])
        }
      },
      ['joinid']
    ),
    xrc137: objectSchema(
      {
        id: { type: 'string', minLength: 1 },
        bundleId: { type: 'string', minLength: 1 },
        address: { type: 'string' },
        meta: objectSchema(
          {
            type: { const: 'xrc137' },
            alias: { type: 'string', pattern: ALIAS_RE.source },
            bundleId: { type: 'string', minLength: 1 },
            version: { type: 'string' },
            deployedAddress: { type: 'string', pattern: EVM_ADDRESS_RE.source }
          },
          ['type', 'alias', 'bundleId']
        ),
        name: { type: 'string' },
        contractId: { type: 'string' },
        payload: {
          type: 'object',
          propertyNames: { pattern: IDENTIFIER_RE.source },
          additionalProperties: objectSchema({ type: { enum: XRC_TYPES }, default: {} }, ['type'])
        },
        apiCalls: { type: 'array', items: { $ref: '#/$defs/apiCall' } },
        contractReads: { type: 'array', items: { $ref: '#/$defs/contractRead' } },
        rules: { type: 'array', items: { anyOf: [{ type: 'string', minLength: 1 }, ruleObjectSchema] } },
        onValid: { $ref: '#/$defs/xrc137Branch' },
        onInvalid: { $ref: '#/$defs/xrc137Branch' }
      },
      ['id', 'bundleId', 'address', 'meta', 'payload']
    ),
    xrc137Branch: objectSchema({ waitSec: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1 }] }, payload: { type: 'object' }, execution: { $ref: '#/$defs/execution' }, encryptLogs: { type: 'boolean' }, logExpireDays: { type: 'integer', minimum: 0 }, grants: { type: 'array', items: { $ref: '#/$defs/grant' } }, wakeUps: { type: 'array', items: { $ref: '#/$defs/wakeUp' } } }),
    apiCall: objectSchema({ name: { type: 'string', pattern: IDENTIFIER_RE.source }, method: { enum: ['GET', 'POST', 'PUT', 'PATCH'] }, urlTemplate: { type: 'string', minLength: 1 }, contentType: { const: 'json' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, bodyTemplate: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 0 }, extractMap: { type: 'object', minProperties: 1, propertyNames: { pattern: IDENTIFIER_RE.source }, additionalProperties: { $ref: '#/$defs/extractSpec' } } }, ['name', 'urlTemplate', 'extractMap']),
    extractSpec: objectSchema({ type: { enum: XRC_TYPES }, value: {}, default: {}, save: { type: 'boolean' } }, ['type', 'value']),
    contractRead: objectSchema({ to: { type: 'string', minLength: 1 }, function: { type: 'string', minLength: 1 }, args: { type: 'array', items: typedValueSchema }, saveAs: { type: 'object', propertyNames: { pattern: '^[0-9]+$' }, additionalProperties: { $ref: '#/$defs/saveTarget' } }, rpc: { type: 'string' } }, ['to', 'function']),
    saveTarget: objectSchema({ key: { type: 'string', pattern: IDENTIFIER_RE.source }, type: { enum: XRC_TYPES }, default: {} }, ['key', 'type']),
    typedValue: typedValueSchema,
    ruleObject: ruleObjectSchema,
    execution: objectSchema({ to: { type: 'string' }, function: { type: 'string' }, args: { type: 'array', items: typedValueSchema }, value: typedValueSchema, gas: objectSchema({ limit: { type: 'integer', minimum: 0 } }), extras: { type: 'object' } }),
    grant: objectSchema({ address: { type: 'string', pattern: EVM_ADDRESS_RE.source }, rights: { enum: [1, 2, 4] }, expireDays: { type: 'integer', minimum: 0 }, logExpireDays: { type: 'integer', minimum: 0 } }, ['address', 'rights']),
    wakeUp: objectSchema({ runner: { type: 'string' }, sessionId: {}, stepId: { type: 'string', pattern: STEP_ID_RE.source }, payload: { type: 'object' } }, ['runner', 'sessionId', 'stepId'])
  }
} as const;

export const xgrLegacySessionStartValidationSchema = objectSchema(
  {
    entryStepId: { type: 'string', minLength: 1 },
    payload: { type: 'object' }
  },
  ['entryStepId', 'payload']
);

export const xgrSessionStartSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Canonical XDaLa Session Start Handoff schema',
  description: 'Workbench Session Start Handoff schema. Use sessions[].stepId for the start step; entryStepId is legacy/internal and is not a Workbench Session Start field.',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'version', 'handle', 'mode', 'sessions', 'execution', 'signing', 'executorGrants', 'chain', 'ui', 'security'],
  properties: {
    type: { const: 'xdala_session_start' },
    version: { const: 'xgr-session-start@1' },
    handle: { type: 'string', minLength: 1 },
    mode: { enum: ['single', 'queue'] },
    sessions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['orchestration', 'ostcId', 'stepId', 'payload', 'maxTotalGas'],
        properties: {
          orchestration: { type: 'string', pattern: EVM_ADDRESS_RE.source },
          ostcId: { type: 'string', minLength: 1 },
          ostcHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
          stepId: { type: 'string', minLength: 1 },
          payload: { type: 'object' },
          maxTotalGas: { type: 'integer', minimum: 0 }
        }
      }
    },
    execution: { type: 'object' },
    signing: { type: 'object' },
    executorGrants: { type: 'object' },
    chain: { type: 'object' },
    ui: { type: 'object' },
    security: { type: 'object' }
  }
} as const;

export const xgrMultiBundleReference = `# XGR MultiBundle Reference

Canonical format: ${FORMAT}

MultiBundle contains deployable XRC-729/XRC-137 authoring objects only. Session start data is a separate object and must not be embedded in the MultiBundle.

Root object:
- Allowed fields are only format, createdAt and bundles.
- format must be "${FORMAT}".
- createdAt must be an ISO date-time string.
- bundles must be a non-empty array.
- Top-level validation metadata, notes, status and tools are forbidden.

Each bundle:
- Allowed fields are only bundleId and items.
- bundleId is required and non-empty.
- items must contain exactly one XRC-729 item and one or more XRC-137 items.
- Bundle-level description, entryStepId, initialPayload and requiredDeployments are forbidden.

XRC-729 orchestration item:
- Requires id, bundleId, meta and structure.
- meta requires type="xrc729", alias and bundleId.
- ostcId is forbidden.
- item.bundleId and meta.bundleId must equal the parent bundleId.
- step.rule may only be a deployed 0x address or cm:xrc137:<Alias>. Short cm:<Alias> is not canonical and is rejected.

XRC-137 rule item:
- Requires id, bundleId, address, meta and payload.
- meta requires type="xrc137", alias and bundleId.
- item.bundleId and meta.bundleId must equal the parent bundleId.
- address may be a deployed 0x address or cm:xrc137:<Alias>; placeholders must equal cm:xrc137:<meta.alias>.
- Root payload is input schema only. Payload fields may only contain type/default.
- onValid.payload and onInvalid.payload are output value maps, not input schemas.

API calls use name, urlTemplate and extractMap. extractMap values are ExtractSpec objects with type and value; shorthand strings and expr are forbidden.
Contract reads use saveAs object maps with numeric string keys; legacy saveAs strings, save arrays and defaults are forbidden.
TypedValue objects contain type, value and optional default only; expr is forbidden.

Workbench Session Start handoffs use canonical xgr-session-start@1 with type: "xdala_session_start" and sessions[].stepId, sessions[].payload and sessions[].maxTotalGas. Do not present entryStepId as the Workbench Session Start field. The legacy { entryStepId, payload } shape is internal validation guidance only.

Session start ownership is separate from XRC-729 contract ownership. owner()/getOwner() identifies the XRC-729 contract owner, and getExecutorList() identifies allowed executors; those are start-authority roles only. A not-yet-started session has no final actual session owner/starter unless sessions[].starterAddress explicitly declares an intended starter. Prefer terminal Workbench result data such as result.results[].owner, sessionId or pid when describing a completed session owner/starter. If a user asks for a session-owner balance before start, ask which role to query and label returned balances by role.
`;

function isMap(value: unknown): value is JsonMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(issues: Issue[], level: Issue['level'], code: string, message: string, path?: string): void {
  issues.push({ level, code, message, ...(path ? { path } : {}) });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidIsoDateTime(value: unknown): boolean {
  if (!isNonEmptyString(value) || !ISO_DATE_TIME_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function getMeta(item: JsonMap): JsonMap | undefined {
  return isMap(item.meta) ? item.meta : undefined;
}

function detectItemKind(item: unknown): ItemKind {
  if (!isMap(item)) return 'unknown';
  const meta = getMeta(item);
  if (meta?.type === 'xrc729') return 'xrc729';
  if (meta?.type === 'xrc137') return 'xrc137';
  if (isMap(item.structure)) return 'xrc729';
  if (isMap(item.payload)) return 'xrc137';
  return 'unknown';
}

function placeholderFromRule(rule: string): string | undefined {
  const fullMatch = /^cm:xrc137:([A-Za-z][A-Za-z0-9_-]{1,127})$/.exec(rule);
  return fullMatch ? `cm:xrc137:${fullMatch[1]}` : undefined;
}

function placeholderAlias(placeholder: string): string {
  return placeholder.slice('cm:xrc137:'.length);
}

function checkKeys(value: JsonMap, allowed: Set<string>, errors: Issue[], code: string, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(errors, 'error', code, `Field ${key} is not allowed.`, `${path}.${key}`);
  }
}

function validAlias(value: unknown): value is string {
  return isNonEmptyString(value) && ALIAS_RE.test(value);
}

function validType(value: unknown): value is string {
  return isNonEmptyString(value) && ALLOWED_TYPES.has(value);
}

function validateTypedValue(value: unknown, errors: Issue[], path: string): void {
  if (!isMap(value)) {
    addIssue(errors, 'error', 'TYPED_VALUE_NOT_OBJECT', 'TypedValue must be an object.', path);
    return;
  }
  checkKeys(value, TYPED_VALUE_KEYS, errors, 'TYPED_VALUE_FIELD_INVALID', path);
  if (!validType(value.type)) addIssue(errors, 'error', 'TYPED_VALUE_TYPE_INVALID', 'TypedValue requires a valid XRC type.', `${path}.type`);
  if (!Object.prototype.hasOwnProperty.call(value, 'value')) addIssue(errors, 'error', 'TYPED_VALUE_VALUE_MISSING', 'TypedValue requires value.', `${path}.value`);
}

function validateMeta(meta: unknown, expectedType: 'xrc729' | 'xrc137', parentBundleId: string, errors: Issue[], path: string): string | undefined {
  const prefix = expectedType.toUpperCase();
  if (!isMap(meta)) {
    addIssue(errors, 'error', `${prefix}_META_MISSING`, `${expectedType} meta is required.`, path);
    return undefined;
  }
  checkKeys(meta, META_KEYS, errors, `${prefix}_META_FIELD_INVALID`, path);
  if (meta.type !== expectedType) addIssue(errors, 'error', `${prefix}_META_TYPE_INVALID`, `meta.type must be ${expectedType}.`, `${path}.type`);
  if (!validAlias(meta.alias)) addIssue(errors, 'error', `${prefix}_META_ALIAS_INVALID`, 'meta.alias is required and must be a valid alias.', `${path}.alias`);
  if (!isNonEmptyString(meta.bundleId)) addIssue(errors, 'error', `${prefix}_META_BUNDLE_ID_MISSING`, 'meta.bundleId is required.', `${path}.bundleId`);
  else if (meta.bundleId !== parentBundleId) addIssue(errors, 'error', `${prefix}_META_BUNDLE_ID_MISMATCH`, 'meta.bundleId must equal parent bundleId.', `${path}.bundleId`);
  if (meta.deployedAddress !== undefined && (!isNonEmptyString(meta.deployedAddress) || !EVM_ADDRESS_RE.test(meta.deployedAddress))) {
    addIssue(errors, 'error', `${prefix}_META_DEPLOYED_ADDRESS_INVALID`, 'deployedAddress must be a 0x address.', `${path}.deployedAddress`);
  }
  return validAlias(meta.alias) ? meta.alias : undefined;
}

function validateBundleId(item: JsonMap, parentBundleId: string, prefix: 'XRC729' | 'XRC137', errors: Issue[], path: string): void {
  if (!isNonEmptyString(item.bundleId)) addIssue(errors, 'error', `${prefix}_BUNDLE_ID_MISSING`, 'item.bundleId is required.', `${path}.bundleId`);
  else if (item.bundleId !== parentBundleId) addIssue(errors, 'error', `${prefix}_BUNDLE_ID_MISMATCH`, 'item.bundleId must equal parent bundleId.', `${path}.bundleId`);
}

function validatePayload(payload: unknown, errors: Issue[], path: string): { required: Set<string>; optional: Set<string> } {
  const required = new Set<string>();
  const optional = new Set<string>();
  if (!isMap(payload)) {
    addIssue(errors, 'error', 'XRC137_PAYLOAD_INVALID', 'payload must be an object.', path);
    return { required, optional };
  }
  for (const [field, spec] of Object.entries(payload)) {
    const fieldPath = `${path}.${field}`;
    if (!IDENTIFIER_RE.test(field)) addIssue(errors, 'error', 'XRC137_PAYLOAD_FIELD_NAME_INVALID', 'payload field names must be identifier-like.', fieldPath);
    if (!isMap(spec)) {
      addIssue(errors, 'error', 'XRC137_PAYLOAD_FIELD_NOT_OBJECT', 'payload field values must be objects.', fieldPath);
      continue;
    }
    checkKeys(spec, PAYLOAD_FIELD_KEYS, errors, 'XRC137_PAYLOAD_FIELD_KEY_INVALID', fieldPath);
    if (spec.required === true) addIssue(errors, 'error', 'XRC137_PAYLOAD_REQUIRED_INVALID', 'payload fields must not use required:true.', `${fieldPath}.required`);
    if (!validType(spec.type)) addIssue(errors, 'error', 'XRC137_PAYLOAD_TYPE_INVALID', 'payload field requires a valid XRC type.', `${fieldPath}.type`);
    if (Object.prototype.hasOwnProperty.call(spec, 'default')) optional.add(field);
    else required.add(field);
  }
  return { required, optional };
}

function validateRules(rules: unknown, errors: Issue[], path: string): void {
  if (rules === undefined) return;
  if (!Array.isArray(rules)) {
    addIssue(errors, 'error', 'XRC137_RULES_NOT_ARRAY', 'rules must be an array.', path);
    return;
  }
  rules.forEach((rule, index) => {
    const rulePath = `${path}.${index}`;
    if (typeof rule === 'string') {
      if (!isNonEmptyString(rule)) addIssue(errors, 'error', 'XRC137_RULE_STRING_EMPTY', 'rule strings must be non-empty.', rulePath);
      return;
    }
    if (!isMap(rule)) {
      addIssue(errors, 'error', 'XRC137_RULE_INVALID', 'rules entries must be strings or objects.', rulePath);
      return;
    }
    checkKeys(rule, RULE_OBJECT_KEYS, errors, 'XRC137_RULE_FIELD_INVALID', rulePath);
    if (!isNonEmptyString(rule.expression)) addIssue(errors, 'error', 'XRC137_RULE_EXPRESSION_MISSING', 'rule object requires expression.', `${rulePath}.expression`);
    if (rule.type !== undefined && !['validate', 'abortStep', 'cancelSession'].includes(String(rule.type))) {
      addIssue(errors, 'error', 'XRC137_RULE_TYPE_INVALID', 'rule type must be validate, abortStep or cancelSession.', `${rulePath}.type`);
    }
  });
}

function validateExecution(execution: unknown, errors: Issue[], path: string): void {
  if (!isMap(execution)) {
    addIssue(errors, 'error', 'XRC137_EXECUTION_NOT_OBJECT', 'execution must be an object.', path);
    return;
  }
  checkKeys(execution, EXECUTION_KEYS, errors, 'XRC137_EXECUTION_FIELD_INVALID', path);
  if (execution.args !== undefined) {
    if (!Array.isArray(execution.args)) addIssue(errors, 'error', 'XRC137_EXECUTION_ARGS_INVALID', 'execution.args must be an array.', `${path}.args`);
    else execution.args.forEach((arg, i) => validateTypedValue(arg, errors, `${path}.args.${i}`));
  }
  if (execution.value !== undefined) validateTypedValue(execution.value, errors, `${path}.value`);
  if (execution.gas !== undefined) {
    if (!isMap(execution.gas)) addIssue(errors, 'error', 'XRC137_EXECUTION_GAS_INVALID', 'gas must be an object.', `${path}.gas`);
    else {
      checkKeys(execution.gas, new Set(['limit']), errors, 'XRC137_EXECUTION_FIELD_INVALID', `${path}.gas`);
      if (execution.gas.limit !== undefined && (!Number.isInteger(execution.gas.limit) || Number(execution.gas.limit) < 0)) addIssue(errors, 'error', 'XRC137_EXECUTION_GAS_LIMIT_INVALID', 'gas.limit must be an integer >= 0.', `${path}.gas.limit`);
    }
  }
}

function validateBranchPayload(payload: unknown, errors: Issue[], path: string): Set<string> {
  const keys = new Set<string>();
  if (payload === undefined) return keys;
  if (!isMap(payload)) {
    addIssue(errors, 'error', 'XRC137_BRANCH_PAYLOAD_INVALID', 'branch payload must be an object.', path);
    return keys;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!IDENTIFIER_RE.test(key)) addIssue(errors, 'error', 'XRC137_BRANCH_PAYLOAD_FIELD_INVALID', 'branch payload keys must be identifier-like.', `${path}.${key}`);
    keys.add(key);
    if (isMap(value) && Object.prototype.hasOwnProperty.call(value, 'type') && Object.keys(value).every((field) => PAYLOAD_FIELD_KEYS.has(field))) {
      addIssue(errors, 'error', 'XRC137_BRANCH_PAYLOAD_SCHEMA_INVALID', 'branch payload is an output value map, not an input schema.', `${path}.${key}`);
    }
  }
  return keys;
}

function validateGrant(grant: unknown, errors: Issue[], path: string): void {
  if (!isMap(grant)) {
    addIssue(errors, 'error', 'XRC137_GRANT_NOT_OBJECT', 'grant must be an object.', path);
    return;
  }
  checkKeys(grant, GRANT_KEYS, errors, 'XRC137_GRANT_FIELD_INVALID', path);
  if (!isNonEmptyString(grant.address) || !EVM_ADDRESS_RE.test(grant.address)) addIssue(errors, 'error', 'XRC137_GRANT_ADDRESS_INVALID', 'grant.address must be a 0x address.', `${path}.address`);
  if (![1, 2, 4].includes(Number(grant.rights))) addIssue(errors, 'error', 'XRC137_GRANT_RIGHTS_INVALID', 'grant.rights must be 1, 2 or 4.', `${path}.rights`);
  for (const key of ['expireDays', 'logExpireDays']) if (grant[key] !== undefined && (!Number.isInteger(grant[key]) || Number(grant[key]) < 0)) addIssue(errors, 'error', 'XRC137_GRANT_DAYS_INVALID', `${key} must be an integer >= 0.`, `${path}.${key}`);
}

function validateWakeUp(wakeUp: unknown, stepIds: Set<string>, errors: Issue[], path: string): void {
  if (!isMap(wakeUp)) {
    addIssue(errors, 'error', 'XRC137_WAKEUP_NOT_OBJECT', 'wakeUp must be an object.', path);
    return;
  }
  checkKeys(wakeUp, WAKEUP_KEYS, errors, 'XRC137_WAKEUP_FIELD_INVALID', path);
  if (!isNonEmptyString(wakeUp.runner) || (!EVM_ADDRESS_RE.test(wakeUp.runner) && !RUNNER_PLACEHOLDER_RE.test(wakeUp.runner))) addIssue(errors, 'error', 'XRC137_WAKEUP_RUNNER_INVALID', 'runner must be a 0x address or [Placeholder].', `${path}.runner`);
  if (!(Number.isInteger(wakeUp.sessionId) && Number(wakeUp.sessionId) > 0) && !isNonEmptyString(wakeUp.sessionId)) addIssue(errors, 'error', 'XRC137_WAKEUP_SESSION_ID_INVALID', 'sessionId must be a positive integer or non-empty string.', `${path}.sessionId`);
  if (!isNonEmptyString(wakeUp.stepId) || !STEP_ID_RE.test(wakeUp.stepId) || !stepIds.has(wakeUp.stepId)) addIssue(errors, 'error', 'XRC137_WAKEUP_STEP_ID_INVALID', 'stepId must be an existing step id.', `${path}.stepId`);
  if (wakeUp.payload !== undefined && !isMap(wakeUp.payload)) addIssue(errors, 'error', 'XRC137_WAKEUP_PAYLOAD_INVALID', 'wakeUp.payload must be an object.', `${path}.payload`);
}

function validateXrc137Branch(branch: unknown, stepIds: Set<string>, errors: Issue[], path: string): { validProduced: Set<string>; invalidProduced: Set<string>; produced: Set<string> } {
  const produced = new Set<string>();
  if (branch === undefined) return { validProduced: produced, invalidProduced: produced, produced };
  if (!isMap(branch)) {
    addIssue(errors, 'error', 'XRC137_BRANCH_NOT_OBJECT', 'branch must be an object.', path);
    return { validProduced: produced, invalidProduced: produced, produced };
  }
  checkKeys(branch, XRC137_BRANCH_KEYS, errors, 'XRC137_BRANCH_FIELD_INVALID', path);
  if (branch.waitSec !== undefined && !Number.isInteger(branch.waitSec) && !isNonEmptyString(branch.waitSec)) addIssue(errors, 'error', 'XRC137_BRANCH_WAITSEC_INVALID', 'waitSec must be an integer or non-empty string.', `${path}.waitSec`);
  const payloadKeys = validateBranchPayload(branch.payload, errors, `${path}.payload`);
  payloadKeys.forEach((key) => produced.add(key));
  if (branch.execution !== undefined) validateExecution(branch.execution, errors, `${path}.execution`);
  if (branch.encryptLogs !== undefined && typeof branch.encryptLogs !== 'boolean') addIssue(errors, 'error', 'XRC137_BRANCH_ENCRYPT_LOGS_INVALID', 'encryptLogs must be boolean.', `${path}.encryptLogs`);
  if (branch.logExpireDays !== undefined && (!Number.isInteger(branch.logExpireDays) || Number(branch.logExpireDays) < 0)) addIssue(errors, 'error', 'XRC137_BRANCH_LOG_EXPIRE_DAYS_INVALID', 'logExpireDays must be an integer >= 0.', `${path}.logExpireDays`);
  if (branch.grants !== undefined) {
    if (!Array.isArray(branch.grants)) addIssue(errors, 'error', 'XRC137_GRANTS_NOT_ARRAY', 'grants must be an array.', `${path}.grants`);
    else branch.grants.forEach((grant, i) => validateGrant(grant, errors, `${path}.grants.${i}`));
  }
  if (branch.wakeUps !== undefined) {
    if (!Array.isArray(branch.wakeUps)) addIssue(errors, 'error', 'XRC137_WAKEUPS_NOT_ARRAY', 'wakeUps must be an array.', `${path}.wakeUps`);
    else branch.wakeUps.forEach((wakeUp, i) => validateWakeUp(wakeUp, stepIds, errors, `${path}.wakeUps.${i}`));
  }
  return { validProduced: produced, invalidProduced: produced, produced };
}

function validateApiCalls(apiCalls: unknown, errors: Issue[], path: string): Set<string> {
  const produced = new Set<string>();
  if (apiCalls === undefined) return produced;
  if (!Array.isArray(apiCalls)) {
    addIssue(errors, 'error', 'XRC137_APICALLS_NOT_ARRAY', 'apiCalls must be an array.', path);
    return produced;
  }
  apiCalls.forEach((apiCall, index) => {
    const callPath = `${path}.${index}`;
    if (!isMap(apiCall)) {
      addIssue(errors, 'error', 'XRC137_APICALL_NOT_OBJECT', 'apiCall must be an object.', callPath);
      return;
    }
    checkKeys(apiCall, APICALL_KEYS, errors, 'XRC137_APICALL_FIELD_INVALID', callPath);
    if (!isNonEmptyString(apiCall.name) || !IDENTIFIER_RE.test(apiCall.name)) addIssue(errors, 'error', 'XRC137_APICALL_NAME_INVALID', 'apiCall.name is required and must be identifier-like.', `${callPath}.name`);
    if (!isNonEmptyString(apiCall.urlTemplate)) addIssue(errors, 'error', 'XRC137_APICALL_URL_TEMPLATE_MISSING', 'apiCall.urlTemplate is required.', `${callPath}.urlTemplate`);
    if (apiCall.method !== undefined && !['GET', 'POST', 'PUT', 'PATCH'].includes(String(apiCall.method))) addIssue(errors, 'error', 'XRC137_APICALL_METHOD_INVALID', 'method must be GET, POST, PUT or PATCH.', `${callPath}.method`);
    if (apiCall.contentType !== undefined && apiCall.contentType !== 'json') addIssue(errors, 'error', 'XRC137_APICALL_CONTENT_TYPE_INVALID', 'contentType must be json.', `${callPath}.contentType`);
    if (apiCall.headers !== undefined) {
      if (!isMap(apiCall.headers)) addIssue(errors, 'error', 'XRC137_APICALL_HEADERS_INVALID', 'headers must be an object.', `${callPath}.headers`);
      else for (const [key, header] of Object.entries(apiCall.headers)) if (typeof header !== 'string') addIssue(errors, 'error', 'XRC137_APICALL_HEADER_VALUE_INVALID', 'header values must be strings.', `${callPath}.headers.${key}`);
    }
    if (apiCall.bodyTemplate !== undefined && typeof apiCall.bodyTemplate !== 'string') addIssue(errors, 'error', 'XRC137_APICALL_BODY_TEMPLATE_INVALID', 'bodyTemplate must be a string.', `${callPath}.bodyTemplate`);
    if (apiCall.timeoutMs !== undefined && (!Number.isInteger(apiCall.timeoutMs) || Number(apiCall.timeoutMs) < 0)) addIssue(errors, 'error', 'XRC137_APICALL_TIMEOUT_INVALID', 'timeoutMs must be an integer >= 0.', `${callPath}.timeoutMs`);
    if (!isMap(apiCall.extractMap) || Object.keys(apiCall.extractMap).length === 0) {
      addIssue(errors, 'error', 'XRC137_EXTRACTMAP_REQUIRED', 'extractMap must be a non-empty object.', `${callPath}.extractMap`);
    } else {
      for (const [alias, spec] of Object.entries(apiCall.extractMap)) {
        const specPath = `${callPath}.extractMap.${alias}`;
        if (!IDENTIFIER_RE.test(alias)) addIssue(errors, 'error', 'XRC137_EXTRACT_ALIAS_INVALID', 'extractMap aliases must be identifier-like.', specPath);
        produced.add(alias);
        if (!isMap(spec)) {
          addIssue(errors, 'error', 'XRC137_EXTRACT_SPEC_NOT_OBJECT', 'extractMap values must be ExtractSpec objects.', specPath);
          continue;
        }
        checkKeys(spec, EXTRACT_SPEC_KEYS, errors, 'XRC137_EXTRACT_SPEC_FIELD_INVALID', specPath);
        if (!validType(spec.type)) addIssue(errors, 'error', 'XRC137_EXTRACT_SPEC_TYPE_INVALID', 'ExtractSpec requires a valid XRC type.', `${specPath}.type`);
        if (!Object.prototype.hasOwnProperty.call(spec, 'value')) addIssue(errors, 'error', 'XRC137_EXTRACT_SPEC_VALUE_MISSING', 'ExtractSpec requires value.', `${specPath}.value`);
        if (spec.save !== undefined && typeof spec.save !== 'boolean') addIssue(errors, 'error', 'XRC137_EXTRACT_SPEC_SAVE_INVALID', 'ExtractSpec.save must be boolean.', `${specPath}.save`);
      }
    }
  });
  return produced;
}

function validateContractReads(contractReads: unknown, errors: Issue[], path: string): Set<string> {
  const produced = new Set<string>();
  if (contractReads === undefined) return produced;
  if (!Array.isArray(contractReads)) {
    addIssue(errors, 'error', 'XRC137_CONTRACTREADS_NOT_ARRAY', 'contractReads must be an array.', path);
    return produced;
  }
  contractReads.forEach((read, index) => {
    const readPath = `${path}.${index}`;
    if (!isMap(read)) {
      addIssue(errors, 'error', 'XRC137_CONTRACTREAD_NOT_OBJECT', 'contractRead must be an object.', readPath);
      return;
    }
    checkKeys(read, CONTRACT_READ_KEYS, errors, 'XRC137_CONTRACTREAD_FIELD_INVALID', readPath);
    if (!isNonEmptyString(read.to)) addIssue(errors, 'error', 'XRC137_CONTRACTREAD_TO_MISSING', 'contractRead.to is required.', `${readPath}.to`);
    if (!isNonEmptyString(read.function)) addIssue(errors, 'error', 'XRC137_CONTRACTREAD_FUNCTION_MISSING', 'contractRead.function is required.', `${readPath}.function`);
    if (read.args !== undefined) {
      if (!Array.isArray(read.args)) addIssue(errors, 'error', 'XRC137_CONTRACTREAD_ARGS_INVALID', 'args must be an array.', `${readPath}.args`);
      else read.args.forEach((arg, i) => validateTypedValue(arg, errors, `${readPath}.args.${i}`));
    }
    if (typeof read.saveAs === 'string') addIssue(errors, 'error', 'XRC137_CONTRACTREAD_SAVEAS_LEGACY_STRING', 'saveAs must be an object map, not a string.', `${readPath}.saveAs`);
    else if (read.saveAs !== undefined) {
      if (!isMap(read.saveAs)) addIssue(errors, 'error', 'XRC137_CONTRACTREAD_SAVEAS_INVALID', 'saveAs must be an object map.', `${readPath}.saveAs`);
      else for (const [key, target] of Object.entries(read.saveAs)) {
        const targetPath = `${readPath}.saveAs.${key}`;
        if (!/^\d+$/.test(key)) addIssue(errors, 'error', 'XRC137_CONTRACTREAD_SAVEAS_KEY_INVALID', 'saveAs keys must be numeric strings.', targetPath);
        if (!isMap(target)) {
          addIssue(errors, 'error', 'XRC137_CONTRACTREAD_SAVE_TARGET_NOT_OBJECT', 'saveAs entries must be objects.', targetPath);
          continue;
        }
        checkKeys(target, SAVE_TARGET_KEYS, errors, 'XRC137_CONTRACTREAD_SAVE_TARGET_FIELD_INVALID', targetPath);
        if (!isNonEmptyString(target.key) || !IDENTIFIER_RE.test(target.key)) addIssue(errors, 'error', 'XRC137_CONTRACTREAD_SAVE_TARGET_KEY_INVALID', 'save target key is required and must be identifier-like.', `${targetPath}.key`);
        else produced.add(target.key);
        if (!validType(target.type)) addIssue(errors, 'error', 'XRC137_CONTRACTREAD_SAVE_TARGET_TYPE_INVALID', 'save target type is required and must be valid.', `${targetPath}.type`);
      }
    }
  });
  return produced;
}

function validateXrc137(item: JsonMap, parentBundleId: string, stepIds: Set<string>, errors: Issue[], path: string): { alias?: string; info?: RuleInfo } {
  checkKeys(item, XRC137_KEYS, errors, 'XRC137_FIELD_INVALID', path);
  if (!isNonEmptyString(item.id)) addIssue(errors, 'error', 'XRC137_ID_MISSING', 'XRC-137 id is required.', `${path}.id`);
  validateBundleId(item, parentBundleId, 'XRC137', errors, path);
  const alias = validateMeta(item.meta, 'xrc137', parentBundleId, errors, `${path}.meta`);
  if (!isNonEmptyString(item.address)) addIssue(errors, 'error', 'XRC137_ADDRESS_MISSING', 'XRC-137 address is required.', `${path}.address`);
  else if (EVM_ADDRESS_RE.test(item.address)) {
    // Deployed address is valid.
  } else if (/^cm:/.test(item.address)) {
    const expected = alias ? `cm:xrc137:${alias}` : undefined;
    if (!expected || item.address !== expected) addIssue(errors, 'error', 'XRC137_ADDRESS_INVALID', 'placeholder address must equal cm:xrc137:<meta.alias>; short cm:<Alias> is invalid.', `${path}.address`);
  } else addIssue(errors, 'error', 'XRC137_ADDRESS_INVALID', 'address must be a 0x address or cm:xrc137:<Alias>.', `${path}.address`);
  if (isMap(item.meta) && item.meta.deployedAddress !== undefined && (!isNonEmptyString(item.meta.deployedAddress) || !EVM_ADDRESS_RE.test(item.meta.deployedAddress))) addIssue(errors, 'error', 'XRC137_META_DEPLOYED_ADDRESS_INVALID', 'deployedAddress must be a 0x address.', `${path}.meta.deployedAddress`);

  const payloadInfo = validatePayload(item.payload, errors, `${path}.payload`);
  validateRules(item.rules, errors, `${path}.rules`);
  const produced = new Set<string>();
  validateApiCalls(item.apiCalls, errors, `${path}.apiCalls`).forEach((key) => produced.add(key));
  validateContractReads(item.contractReads, errors, `${path}.contractReads`).forEach((key) => produced.add(key));
  const validBranch = validateXrc137Branch(item.onValid, stepIds, errors, `${path}.onValid`);
  const invalidBranch = validateXrc137Branch(item.onInvalid, stepIds, errors, `${path}.onInvalid`);
  validBranch.produced.forEach((key) => produced.add(key));
  invalidBranch.produced.forEach((key) => produced.add(key));
  return { alias, info: { required: payloadInfo.required, optional: payloadInfo.optional, produced, validProduced: validBranch.produced, invalidProduced: invalidBranch.produced } };
}

function validateJoin(join: unknown, stepIds: Set<string>, errors: Issue[], path: string): void {
  if (!isMap(join)) {
    addIssue(errors, 'error', 'XRC729_JOIN_NOT_OBJECT', 'join must be an object.', path);
    return;
  }
  checkKeys(join, JOIN_KEYS, errors, 'XRC729_JOIN_FIELD_INVALID', path);
  if (!isNonEmptyString(join.joinid) || !stepIds.has(join.joinid)) addIssue(errors, 'error', 'XRC729_JOIN_ID_INVALID', 'joinid is required and must be an existing step.', `${path}.joinid`);
  let fromLength: number | undefined;
  if (join.from !== undefined) {
    if (!Array.isArray(join.from)) addIssue(errors, 'error', 'XRC729_JOIN_FROM_INVALID', 'join.from must be an array.', `${path}.from`);
    else {
      fromLength = join.from.length;
      join.from.forEach((from, i) => {
        const fromPath = `${path}.from.${i}`;
        if (!isMap(from)) {
          addIssue(errors, 'error', 'XRC729_JOIN_FROM_ENTRY_INVALID', 'join.from entries must be objects.', fromPath);
          return;
        }
        checkKeys(from, new Set(['node', 'when']), errors, 'XRC729_JOIN_FIELD_INVALID', fromPath);
        if (!isNonEmptyString(from.node) || !stepIds.has(from.node)) addIssue(errors, 'error', 'XRC729_JOIN_FROM_NODE_INVALID', 'join.from[].node is required and must be an existing step.', `${fromPath}.node`);
        if (from.when !== undefined && !['valid', 'invalid', 'any', 'both'].includes(String(from.when))) addIssue(errors, 'error', 'XRC729_JOIN_FROM_WHEN_INVALID', 'join.from[].when must be valid, invalid, any or both.', `${fromPath}.when`);
      });
    }
  }
  if (join.waitonjoin !== undefined && !['drain', 'kill'].includes(String(join.waitonjoin))) addIssue(errors, 'error', 'XRC729_JOIN_WAITONJOIN_INVALID', 'waitonjoin must be drain or kill.', `${path}.waitonjoin`);
  if (join.mode !== undefined) {
    if (join.mode === 'any' || join.mode === 'all') return;
    if (!isMap(join.mode) || Object.keys(join.mode).some((key) => key !== 'kofn') || !Number.isInteger(join.mode.kofn)) addIssue(errors, 'error', 'XRC729_JOIN_MODE_INVALID', 'mode must be any, all or {kofn:N}; {k:N} is invalid.', `${path}.mode`);
    else if (Number(join.mode.kofn) < 1 || (fromLength !== undefined && Number(join.mode.kofn) > fromLength)) addIssue(errors, 'error', 'XRC729_JOIN_MODE_INVALID', 'kofn must be >=1 and <= from.length when from exists.', `${path}.mode.kofn`);
  }
}

function validateXrc729Branch(branch: unknown, stepIds: Set<string>, errors: Issue[], warnings: Issue[], path: string, sourceStepId: string): void {
  if (branch === undefined) return;
  if (!isMap(branch)) {
    addIssue(errors, 'error', 'XRC729_BRANCH_NOT_OBJECT', 'branch must be an object.', path);
    return;
  }
  checkKeys(branch, XRC729_BRANCH_KEYS, errors, 'XRC729_BRANCH_FIELD_INVALID', path);
  if (branch.spawns !== undefined) {
    if (!Array.isArray(branch.spawns)) addIssue(errors, 'error', 'XRC729_SPAWNS_INVALID', 'spawns must be an array.', `${path}.spawns`);
    else branch.spawns.forEach((target, i) => {
      if (!isNonEmptyString(target) || !stepIds.has(target)) addIssue(errors, 'error', 'XRC729_SPAWN_TARGET_UNKNOWN', 'spawns targets must be existing step IDs.', `${path}.spawns.${i}`);
      else if (target === sourceStepId) addIssue(warnings, 'warning', 'XRC729_SELF_SPAWN_RETRY_LOOP', 'self-spawn may create a retry loop.', `${path}.spawns.${i}`);
    });
  }
  if (branch.join !== undefined) validateJoin(branch.join, stepIds, errors, `${path}.join`);
}

function validateXrc729(item: JsonMap, parentBundleId: string, errors: Issue[], warnings: Issue[], path: string): { id?: string; placeholders: string[]; stepRules: Map<string, string> } {
  const placeholders = new Set<string>();
  const stepRules = new Map<string, string>();
  checkKeys(item, XRC729_KEYS, errors, 'XRC729_FIELD_INVALID', path);
  if (!isNonEmptyString(item.id)) addIssue(errors, 'error', 'XRC729_ID_MISSING', 'XRC-729 id is required.', `${path}.id`);
  validateBundleId(item, parentBundleId, 'XRC729', errors, path);
  validateMeta(item.meta, 'xrc729', parentBundleId, errors, `${path}.meta`);
  if (item.address !== undefined && (!isNonEmptyString(item.address) || !EVM_ADDRESS_RE.test(item.address))) addIssue(errors, 'error', 'XRC729_ADDRESS_INVALID', 'address must be a 0x address.', `${path}.address`);
  if (!isMap(item.structure) || Object.keys(item.structure).length === 0) {
    addIssue(errors, 'error', 'XRC729_STRUCTURE_MISSING', 'structure is required and must be a non-empty object.', `${path}.structure`);
    return { id: isNonEmptyString(item.id) ? item.id : undefined, placeholders: [], stepRules };
  }
  const stepIds = new Set(Object.keys(item.structure));
  for (const stepId of stepIds) if (!STEP_ID_RE.test(stepId)) addIssue(errors, 'error', 'XRC729_STEP_ID_INVALID', 'step IDs must match ^[A-Za-z][A-Za-z0-9_-]*$.', `${path}.structure.${stepId}`);
  for (const [stepId, step] of Object.entries(item.structure)) {
    const stepPath = `${path}.structure.${stepId}`;
    if (!isMap(step)) {
      addIssue(errors, 'error', 'XRC729_STEP_NOT_OBJECT', 'structure steps must be objects.', stepPath);
      continue;
    }
    checkKeys(step, STEP_KEYS, errors, 'XRC729_STEP_FIELD_INVALID', stepPath);
    if (step.id !== undefined && typeof step.id !== 'string') addIssue(errors, 'error', 'XRC729_STEP_ID_FIELD_INVALID', 'step.id must be a string.', `${stepPath}.id`);
    if (!isNonEmptyString(step.rule)) addIssue(errors, 'error', 'XRC729_STEP_RULE_MISSING', 'step.rule is required.', `${stepPath}.rule`);
    else if (EVM_ADDRESS_RE.test(step.rule)) stepRules.set(stepId, step.rule);
    else {
      const placeholder = placeholderFromRule(step.rule);
      if (!placeholder) addIssue(errors, 'error', 'XRC729_STEP_RULE_INVALID', 'step.rule must be a deployed 0x address or cm:xrc137:<Alias>; short cm:<Alias> is invalid.', `${stepPath}.rule`);
      else {
        placeholders.add(placeholder);
        stepRules.set(stepId, placeholderAlias(placeholder));
      }
    }
    validateXrc729Branch(step.onValid, stepIds, errors, warnings, `${stepPath}.onValid`, stepId);
    validateXrc729Branch(step.onInvalid, stepIds, errors, warnings, `${stepPath}.onInvalid`, stepId);
  }
  return { id: isNonEmptyString(item.id) ? item.id : undefined, placeholders: [...placeholders].sort(), stepRules };
}

function requiredInputFields(rule: RuleInfo | undefined): Set<string> {
  return new Set(rule?.required ?? []);
}

function optionalInputFields(rule: RuleInfo | undefined): Set<string> {
  return new Set(rule?.optional ?? []);
}

function branchOutputFields(rule: RuleInfo | undefined, branchName: 'onValid' | 'onInvalid'): Set<string> {
  if (!rule) return new Set<string>();
  return new Set(branchName === 'onValid' ? rule.validProduced : rule.invalidProduced);
}

function ruleByAlias(ruleInfoByAlias: Map<string, RuleInfo>, alias: string | undefined): RuleInfo | undefined {
  return alias ? ruleInfoByAlias.get(alias) : undefined;
}

function ruleByStep(stepRules: Map<string, string>, ruleInfoByAlias: Map<string, RuleInfo>, stepId: string): RuleInfo | undefined {
  return ruleByAlias(ruleInfoByAlias, stepRules.get(stepId));
}

function validateRequiredInputsProvided(targetStepId: string, targetRule: RuleInfo | undefined, availableFields: Set<string>, errors: Issue[], path: string): void {
  if (!targetRule) return;
  const optionalFields = optionalInputFields(targetRule);
  for (const req of requiredInputFields(targetRule)) {
    if (optionalFields.has(req)) continue;
    if (!availableFields.has(req)) {
      addIssue(errors, 'error', 'XRC137_REQUIRED_INPUT_NOT_PROVIDED', `Required input ${req} for step ${targetStepId} is not provided by predecessor branch payload.`, `${path}.structure.${targetStepId}.rule`);
    }
  }
}

function joinOutputFields(join: JsonMap, stepRules: Map<string, string>, ruleInfoByAlias: Map<string, RuleInfo>): Set<string> {
  const outputFields = new Set<string>();
  if (!Array.isArray(join.from)) return outputFields;

  for (const from of join.from) {
    if (!isMap(from) || !isNonEmptyString(from.node)) continue;
    const producerRule = ruleByStep(stepRules, ruleInfoByAlias, from.node);
    const when = String(from.when ?? 'both');
    if (when === 'valid' || when === 'any' || when === 'both') {
      branchOutputFields(producerRule, 'onValid').forEach((key) => outputFields.add(key));
    }
    if (when === 'invalid' || when === 'any' || when === 'both') {
      branchOutputFields(producerRule, 'onInvalid').forEach((key) => outputFields.add(key));
    }
  }

  return outputFields;
}

function validatePayloadFlow(xrc729: JsonMap, stepRules: Map<string, string>, ruleInfoByAlias: Map<string, RuleInfo>, errors: Issue[], path: string): void {
  if (!isMap(xrc729.structure)) return;

  for (const [sourceStepId, stepObj] of Object.entries(xrc729.structure)) {
    if (!isMap(stepObj)) continue;
    const sourceRule = ruleByStep(stepRules, ruleInfoByAlias, sourceStepId);

    const validateBranch = (branchName: 'onValid' | 'onInvalid'): void => {
      const branch = stepObj[branchName];
      if (!isMap(branch)) return;

      const branchFields = branchOutputFields(sourceRule, branchName);
      if (Array.isArray(branch.spawns)) {
        for (const targetStepId of branch.spawns) {
          if (!isNonEmptyString(targetStepId)) continue;
          validateRequiredInputsProvided(targetStepId, ruleByStep(stepRules, ruleInfoByAlias, targetStepId), branchFields, errors, path);
        }
      }

      if (isMap(branch.join) && isNonEmptyString(branch.join.joinid)) {
        const joinedFields = joinOutputFields(branch.join, stepRules, ruleInfoByAlias);
        validateRequiredInputsProvided(branch.join.joinid, ruleByStep(stepRules, ruleInfoByAlias, branch.join.joinid), joinedFields, errors, path);
      }
    };

    validateBranch('onValid');
    validateBranch('onInvalid');
  }
}

export function validateXgrMultiBundle(input: unknown): MultiBundleValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const bundles: BundleSummary[] = [];

  if (!isMap(input)) {
    addIssue(errors, 'error', 'ROOT_NOT_OBJECT', 'MultiBundle input must be an object.');
    return { valid: false, format: FORMAT, errors, warnings, bundles };
  }
  checkKeys(input, ROOT_KEYS, errors, 'ROOT_FIELD_INVALID', '');
  if (input.format !== FORMAT) addIssue(errors, 'error', 'FORMAT_INVALID', `format must be "${FORMAT}".`, 'format');
  if (!isValidIsoDateTime(input.createdAt)) addIssue(errors, 'error', 'CREATED_AT_INVALID', 'createdAt must be a valid ISO date-time string.', 'createdAt');
  if (!Array.isArray(input.bundles) || input.bundles.length === 0) {
    addIssue(errors, 'error', 'BUNDLES_REQUIRED', 'bundles must be a non-empty array.', 'bundles');
    return { valid: false, format: FORMAT, errors, warnings, bundles };
  }

  input.bundles.forEach((bundle, bundleIndex) => {
    const bundlePath = `bundles.${bundleIndex}`;
    const summary: BundleSummary = { bundleId: '', xrc137Aliases: [], placeholders: [], requiredDeployments: [] };
    bundles.push(summary);
    if (!isMap(bundle)) {
      addIssue(errors, 'error', 'BUNDLE_NOT_OBJECT', 'bundle must be an object.', bundlePath);
      return;
    }
    checkKeys(bundle, BUNDLE_KEYS, errors, 'BUNDLE_FIELD_INVALID', bundlePath);
    if (!isNonEmptyString(bundle.bundleId)) addIssue(errors, 'error', 'BUNDLE_ID_MISSING', 'bundleId is required.', `${bundlePath}.bundleId`);
    else summary.bundleId = bundle.bundleId;
    const parentBundleId = isNonEmptyString(bundle.bundleId) ? bundle.bundleId : '';
    if (!Array.isArray(bundle.items) || bundle.items.length < 2) {
      addIssue(errors, 'error', 'BUNDLE_ITEMS_REQUIRED', 'items must be an array with at least two entries.', `${bundlePath}.items`);
      return;
    }

    const xrc729Items: Array<{ item: JsonMap; path: string }> = [];
    const xrc137Items: Array<{ item: JsonMap; path: string }> = [];
    bundle.items.forEach((item, itemIndex) => {
      const itemPath = `${bundlePath}.items.${itemIndex}`;
      if (!isMap(item)) {
        addIssue(errors, 'error', 'ITEM_NOT_OBJECT', 'items entries must be objects.', itemPath);
        return;
      }
      const kind = detectItemKind(item);
      if (kind === 'xrc729') xrc729Items.push({ item, path: itemPath });
      else if (kind === 'xrc137') xrc137Items.push({ item, path: itemPath });
      else addIssue(errors, 'error', 'ITEM_TYPE_UNKNOWN', 'Item type is unknown; use meta.type xrc729/xrc137 or provide structure/payload fallback.', itemPath);
    });
    if (xrc729Items.length !== 1) addIssue(errors, 'error', 'XRC729_COUNT_INVALID', 'Each bundle must contain exactly one XRC-729 item.', `${bundlePath}.items`);
    if (xrc137Items.length < 1) addIssue(errors, 'error', 'XRC137_COUNT_INVALID', 'Each bundle must contain at least one XRC-137 item.', `${bundlePath}.items`);

    const stepIds = xrc729Items.length === 1 && isMap(xrc729Items[0].item.structure) ? new Set(Object.keys(xrc729Items[0].item.structure)) : new Set<string>();
    const aliases = new Set<string>();
    const ruleInfoByAlias = new Map<string, RuleInfo>();
    for (const { item, path } of xrc137Items) {
      const result = validateXrc137(item, parentBundleId, stepIds, errors, path);
      if (result.alias) {
        aliases.add(result.alias);
        if (result.info) ruleInfoByAlias.set(result.alias, result.info);
      }
    }
    summary.xrc137Aliases = [...aliases].sort();

    if (xrc729Items.length === 1) {
      const { item, path } = xrc729Items[0];
      const xrc729 = validateXrc729(item, parentBundleId, errors, warnings, path);
      if (xrc729.id) summary.xrc729Id = xrc729.id;
      summary.placeholders = xrc729.placeholders;
      const requiredDeployments = new Set<string>();
      for (const placeholder of xrc729.placeholders) {
        const alias = placeholderAlias(placeholder);
        requiredDeployments.add(alias);
        if (!aliases.has(alias)) addIssue(errors, 'error', 'PLACEHOLDER_ALIAS_UNRESOLVED', `XRC-729 placeholder ${placeholder} must match an XRC-137 meta.alias in the same bundle.`, path);
      }
      for (const alias of aliases) if (!requiredDeployments.has(alias)) addIssue(warnings, 'warning', 'XRC137_ITEM_UNUSED', `XRC-137 alias ${alias} is not referenced by XRC-729.`, bundlePath);
      summary.requiredDeployments = [...requiredDeployments].sort();
      validatePayloadFlow(item, xrc729.stepRules, ruleInfoByAlias, errors, path);
    }
  });

  return { valid: errors.length === 0, format: FORMAT, errors, warnings, bundles };
}

export function validateXgrSessionStart(input: unknown): SessionStartValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isMap(input)) {
    addIssue(errors, 'error', 'SESSION_START_NOT_OBJECT', 'Session start must be an object.');
    return { valid: false, errors, warnings };
  }
  checkKeys(input, new Set(['entryStepId', 'payload']), errors, 'SESSION_START_FIELD_INVALID', '');
  if (!isNonEmptyString(input.entryStepId)) addIssue(errors, 'error', 'SESSION_START_ENTRY_STEP_ID_MISSING', 'entryStepId is required and must be non-empty.', 'entryStepId');
  if (!isMap(input.payload)) addIssue(errors, 'error', 'SESSION_START_PAYLOAD_INVALID', 'payload is required and must be an object.', 'payload');
  return { valid: errors.length === 0, errors, warnings };
}
