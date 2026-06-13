type JsonMap = Record<string, unknown>;

type ValidationIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
};

type RuleValidationInput = {
  rules: unknown;
  availableFields?: string[];
};

type RuleValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  placeholders: string[];
};

const placeholderRe = /\[([A-Za-z][A-Za-z0-9_]*)\]/g;
const forbiddenPlaceholderPatterns = [
  { code: 'DOLLAR_INPUT_PLACEHOLDER', pattern: /\$input\./, label: 'dollar-input placeholder syntax' },
  { code: 'DOLLAR_API_PLACEHOLDER', pattern: /\$api\./, label: 'dollar-api placeholder syntax' },
  { code: 'DOLLAR_BRACE_PLACEHOLDER', pattern: /\$\{[^}]+\}/, label: 'dollar-brace placeholder syntax' }
];

function isMap(value: unknown): value is JsonMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(target: ValidationIssue[], level: ValidationIssue['level'], code: string, message: string, path?: string): void {
  target.push({ level, code, message, ...(path ? { path } : {}) });
}

function looksLikeWeakProseRule(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (text === 'true' || text === 'false') return false;
  return !/[\[\]()!=<>+\-*/&|]/.test(text) && /\s/.test(text);
}

function collectPlaceholders(text: string): string[] {
  placeholderRe.lastIndex = 0;
  return [...text.matchAll(placeholderRe)].map((match) => match[1]);
}

function validateRuleExpression(text: string, available: Set<string>, placeholders: Set<string>, errors: ValidationIssue[], warnings: ValidationIssue[], path: string): void {
  if (!text.trim()) {
    addIssue(errors, 'error', 'RULE_EMPTY', 'Rule expression must not be empty.', path);
    return;
  }

  for (const forbidden of forbiddenPlaceholderPatterns) {
    if (forbidden.pattern.test(text)) {
      addIssue(errors, 'error', forbidden.code, `Invalid ${forbidden.label}; use bracket placeholders such as [fieldName].`, path);
    }
  }

  if (looksLikeWeakProseRule(text)) {
    addIssue(warnings, 'warning', 'RULE_WEAK_PROSE', 'Rule looks like prose, not an executable validation expression. For pure output steps use "true".', path);
  }

  for (const placeholder of collectPlaceholders(text)) {
    placeholders.add(placeholder);
    if (!available.has(placeholder)) {
      addIssue(errors, 'error', 'PLACEHOLDER_UNKNOWN', `Placeholder [${placeholder}] is not available in this rule context. Declare it in payload, apiCalls.extractMap or contractReads.saveAs before using it.`, path);
    }
  }
}

export function validateXDaLaRules(input: RuleValidationInput): RuleValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const placeholders = new Set<string>();
  const available = new Set(input.availableFields ?? []);

  if (!Array.isArray(input.rules)) {
    addIssue(errors, 'error', 'RULES_NOT_ARRAY', 'rules must be an array.', 'rules');
    return { valid: false, errors, warnings, placeholders: [] };
  }

  input.rules.forEach((rule, index) => {
    const path = `rules.${index}`;
    if (typeof rule === 'string') {
      validateRuleExpression(rule, available, placeholders, errors, warnings, path);
      return;
    }

    if (!isMap(rule)) {
      addIssue(errors, 'error', 'RULE_INVALID', 'Rule entries must be strings or objects.', path);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(rule, 'id')) {
      addIssue(errors, 'error', 'RULE_ID_INVALID', 'Rule objects do not use id.', `${path}.id`);
    }
    if (Object.prototype.hasOwnProperty.call(rule, 'expr')) {
      addIssue(errors, 'error', 'RULE_EXPR_INVALID', 'Rule objects use expression, not expr.', `${path}.expr`);
    }
    if (typeof rule.expression !== 'string') {
      addIssue(errors, 'error', 'RULE_EXPRESSION_MISSING', 'Rule object requires a non-empty expression string.', `${path}.expression`);
    } else {
      validateRuleExpression(rule.expression, available, placeholders, errors, warnings, `${path}.expression`);
    }
    if (rule.type !== undefined && !['validate', 'abortStep', 'cancelSession'].includes(String(rule.type))) {
      addIssue(errors, 'error', 'RULE_TYPE_INVALID', 'Rule type must be validate, abortStep or cancelSession.', `${path}.type`);
    }
  });

  return { valid: errors.length === 0, errors, warnings, placeholders: [...placeholders].sort() };
}
