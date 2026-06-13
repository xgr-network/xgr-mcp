import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerChainTools } from './chainTools.js';
import { registerDiagramTools } from './diagramTools.js';
import { registerKnowledgeTools } from './knowledgeTools.js';
import { registerOperationTools } from './operationTools.js';
import { registerReceiptTools } from './receiptTools.js';
import { registerSessionTools } from './sessionTools.js';
import { registerSessionResolverTools } from './sessionResolverTools.js';
import { registerTransactionTools } from './transactionTools.js';
import { registerXgrTools } from './xgrTools.js';
import { registerXrcTools } from './xrcTools.js';
import { writeToolUsage } from '../shared/usageLog.js';

type ToolOptions = Record<string, unknown> & {
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

type ToolResult = Record<string, unknown> & {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
};

type DescribableSchema = {
  describe: (description: string) => unknown;
  description?: string;
  _def?: { description?: string };
};

const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  address: 'EVM wallet, Safe or contract address in 0x-prefixed hexadecimal format.',
  owner: 'EVM address of the XDaLa session owner or relevant account.',
  from: 'Sender address or lower bound used for the query.',
  to: 'Recipient address, contract address or upper bound used for the query.',
  txHash: '0x-prefixed transaction hash to inspect or resolve.',
  transactionHash: '0x-prefixed transaction hash to inspect or resolve.',
  blockHash: '0x-prefixed block hash to inspect or resolve.',
  blockNumber: 'Block number or block identifier used for the chain lookup.',
  chainId: 'Numeric EVM chain id for the target network.',
  network: 'Target network name or environment, for example mainnet or devnet.',
  sessionId: 'XDaLa session identifier used to query runtime or explorer data.',
  pid: 'XDaLa process id within a session tree.',
  rootPid: 'Root XDaLa process id for the session tree.',
  parentPid: 'Parent process id within an XDaLa session tree.',
  step: 'Human-readable XDaLa step label or step identifier.',
  stepId: 'Canonical XDaLa step id used by Workbench/session-start requests.',
  ostcId: 'Orchestration step contract id for the XDaLa workflow.',
  ostcHash: 'Hash or identifier of the orchestration step contract artifact.',
  orchestration: 'Address or identifier of the deployed XDaLa orchestration contract.',
  bundle: 'Canonical XDaLa bundle JSON object to validate, store or hand off.',
  bundleDeployHandle: 'Opaque handle returned by the XDaLa bundle deploy handoff flow.',
  handle: 'Opaque handoff handle returned by a previous XDaLa MCP tool.',
  operationId: 'Identifier of a stored offchain operation handoff.',
  secret: 'Secret token required to read or cancel protected handoff state.',
  request: 'Canonical request object used by the target XDaLa workflow operation.',
  sessions: 'Array of canonical xgr-session-start@1 session requests.',
  payload: 'Structured payload object for an XDaLa step or workflow request.',
  summary: 'Structured summary metadata for human review and audit context.',
  validation: 'Validation metadata or validation result object for the handoff.',
  policy: 'Policy metadata controlling human review, approval or execution constraints.',
  steps: 'Ordered workflow or operation steps included in the handoff.',
  signing: 'Signing metadata for Workbench or local wallet handoff preparation.',
  executorGrants: 'Executor grant metadata for prepared XDaLa session-start requests.',
  execution: 'Execution metadata for prepared XDaLa workflow requests.',
  ui: 'Optional user-interface metadata for Workbench import and display.',
  security: 'Optional security metadata for handoff preparation.',
  expectedSigner: 'Expected wallet address that should sign or execute the prepared handoff.',
  walletAddress: 'Wallet address used as intended signer, starter or actor context.',
  starterAddress: 'Wallet address intended to start the prepared XDaLa session.',
  maxTotalGas: 'Maximum total gas budget allowed for the prepared XDaLa session request.',
  expiry: 'Unix timestamp or expiry value for the prepared request.',
  ttlSeconds: 'Time-to-live in seconds for temporary offchain handoff data.',
  page: 'One-based page number for paginated explorer/API results.',
  limit: 'Maximum number of records to return.',
  last: 'Maximum number of most recent records to inspect.',
  window: 'Time window for aggregated analytics or overview data.',
  type: 'Operation or handoff type identifier.',
  hash: '0x-prefixed hash value or canonical identifier.',
  contractAddress: 'EVM contract address in 0x-prefixed hexadecimal format.',
  tokenAddress: 'EVM token contract address in 0x-prefixed hexadecimal format.',
  account: 'EVM account address used for the query.',
  module: 'XGR or XDaLa module identifier used for lookup or filtering.',
  name: 'Name used for lookup, generation or display.',
  query: 'Search query or natural-language lookup input.',
  id: 'Identifier used to select a specific object, record or artifact.',
  source: 'Source type for deriving the prepared XDaLa request.'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolOptions(value: unknown): value is ToolOptions {
  return isRecord(value);
}

function isDescribableSchema(value: unknown): value is DescribableSchema {
  return isRecord(value) && typeof value.describe === 'function';
}

function hasSchemaDescription(schema: DescribableSchema): boolean {
  return typeof schema.description === 'string' || typeof schema._def?.description === 'string';
}

function humanizeParameterName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function parameterDescription(name: string): string {
  return PARAMETER_DESCRIPTIONS[name] ?? `Value for the ${humanizeParameterName(name)} parameter.`;
}

function withParameterDescriptions(inputSchema: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!inputSchema) return inputSchema;

  const described: Record<string, unknown> = { ...inputSchema };
  for (const [name, schema] of Object.entries(inputSchema)) {
    if (!isDescribableSchema(schema) || hasSchemaDescription(schema)) continue;
    described[name] = schema.describe(parameterDescription(name));
  }

  return described;
}

function operationKind(name: string): 'read' | 'handoff' | 'mutation' {
  if (name.startsWith('get_') || name.startsWith('list_') || name.startsWith('resolve_') || name.startsWith('estimate_') || name.startsWith('inspect_') || name.startsWith('render_')) {
    return 'read';
  }

  if (name.includes('_handoff')) {
    return 'handoff';
  }

  if (name.startsWith('create_') || name.startsWith('cancel_') || name.startsWith('prepare_') || name.startsWith('build_')) {
    return 'handoff';
  }

  return 'read';
}

function annotationsForTool(name: string, options: ToolOptions): Record<string, unknown> {
  const kind = operationKind(name);
  const existing = isRecord(options.annotations) ? options.annotations : {};

  return {
    readOnlyHint: kind === 'read',
    destructiveHint: false,
    idempotentHint: kind !== 'mutation',
    openWorldHint: true,
    ...existing
  };
}

function enhanceToolOptions(name: string, options: ToolOptions): ToolOptions {
  return {
    ...options,
    inputSchema: withParameterDescriptions(options.inputSchema),
    outputSchema: options.outputSchema ?? {
      data: z.unknown().describe('Structured result data returned by the XGR MCP gateway.')
    },
    annotations: annotationsForTool(name, options)
  };
}

function parseTextContent(result: ToolResult): unknown {
  const text = result.content?.find((item) => item.type === 'text' && typeof item.text === 'string')?.text;
  if (typeof text !== 'string') return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function withStructuredContent(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const result = value as ToolResult;
  if (result.structuredContent !== undefined) return value;

  const data = parseTextContent(result);
  if (data === undefined) return value;

  return {
    ...result,
    structuredContent: { data }
  };
}

function instrumentRegisterTool(server: McpServer): void {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (...args: unknown[]) => {
    const name = typeof args[0] === 'string' ? args[0] : 'unknown';
    const options = args[1];
    if (isToolOptions(options)) {
      args[1] = enhanceToolOptions(name, options);
    }

    const handler = args[args.length - 1];
    if (typeof handler === 'function') {
      const wrapped = async (...handlerArgs: unknown[]) => {
        const start = Date.now();
        try {
          const out = withStructuredContent(await (handler as (...a: unknown[]) => unknown)(...handlerArgs));
          void writeToolUsage({ at: new Date().toISOString(), kind: 'tool_call', tool: name, ok: true, durationMs: Date.now() - start });
          return out;
        } catch (error) {
          void writeToolUsage({ at: new Date().toISOString(), kind: 'tool_call', tool: name, ok: false, durationMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      };
      args[args.length - 1] = wrapped;
    }
    return original(...args);
  };
}

export function registerTools(server: McpServer): void {
  instrumentRegisterTool(server);
  registerChainTools(server);
  registerTransactionTools(server);
  registerSessionTools(server);
  registerSessionResolverTools(server);
  registerReceiptTools(server);
  registerXgrTools(server);
  registerXrcTools(server);
  registerOperationTools(server);
  registerDiagramTools(server);
  registerKnowledgeTools(server);
}
