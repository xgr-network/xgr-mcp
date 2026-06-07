import 'dotenv/config';

function getEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function getFirstEnv(names: string[], fallback: string): string {
  for (const name of names) {
    const value = getOptionalEnv(name);
    if (value) return value;
  }
  return fallback;
}

function getIntEnv(name: string, fallback: number): number {
  const raw = getEnv(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBoolEnv(name: string, fallback: boolean): boolean {
  const raw = getOptionalEnv(name);
  if (!raw) return fallback;
  return !['false', '0', 'no', 'off'].includes(raw.toLowerCase());
}

function getCsvEnv(name: string): string[] {
  return (getOptionalEnv(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

const operationStoreDir = getEnv('MCP_OPERATION_STORE_DIR', './data/operations');
const publicHandoffAuditLogPath = getOptionalEnv('MCP_PUBLIC_HANDOFF_AUDIT_LOG_PATH') ?? `${operationStoreDir}/audit/public-handoff.jsonl`;
const toolUsageLogPath = getOptionalEnv('MCP_TOOL_USAGE_LOG_PATH') ?? `${operationStoreDir}/audit/tool-usage.jsonl`;

export const env = {
  serverName: getEnv('MCP_SERVER_NAME', 'xgr-mcp-gateway'),
  rpcUrl: getEnv('XGR_RPC_URL', 'https://rpc.xgr.network'),
  explorerApiUrl: getEnv('XGR_EXPLORER_API_URL', 'https://explorer.xgr.network/api'),
  readOnly: getEnv('MCP_READONLY', 'true') !== 'false',
  httpHost: getEnv('MCP_HTTP_HOST', '127.0.0.1'),
  httpPort: getIntEnv('MCP_HTTP_PORT', 3100),
  operations: {
    storeDir: operationStoreDir,
    publicBaseUrl: getFirstEnv(['MCP_PUBLIC_BASE_URL', 'MCP_OPERATION_PUBLIC_BASE_URL'], 'https://mcp.xgr.network'),
    defaultTtlSeconds: getIntEnv('MCP_OPERATION_DEFAULT_TTL_SECONDS', 3600),
    maxTtlSeconds: getIntEnv('MCP_OPERATION_MAX_TTL_SECONDS', 86400)
  },
  bundleDeploy: {
    storeDir: getOptionalEnv('MCP_BUNDLE_DEPLOY_STORE_DIR') ?? `${operationStoreDir}/bundle-deploy`,
    xdalaBaseUrl: getEnv('MCP_XDALA_BUNDLE_DEPLOY_BASE_URL', 'https://xdala.xgr.network/api/bundle-deploy'),
    defaultTtlSeconds: getIntEnv('MCP_BUNDLE_DEPLOY_DEFAULT_TTL_SECONDS', 3600),
    maxTtlSeconds: getIntEnv('MCP_BUNDLE_DEPLOY_MAX_TTL_SECONDS', 86400)
  },
  sessionStart: {
    storeDir: getOptionalEnv('MCP_SESSION_START_STORE_DIR') ?? `${operationStoreDir}/session-start`,
    xdalaBaseUrl: getEnv('MCP_XDALA_SESSION_START_BASE_URL', 'https://xdala.xgr.network/session-start'),
    defaultTtlSeconds: getIntEnv('MCP_SESSION_START_DEFAULT_TTL_SECONDS', 3600),
    maxTtlSeconds: getIntEnv('MCP_SESSION_START_MAX_TTL_SECONDS', 86400)
  },
  usage: {
    enabled: getBoolEnv('MCP_TOOL_USAGE_ENABLED', true),
    logPath: toolUsageLogPath
  },
  publicHandoff: {
    maxBodyBytes: getIntEnv('MCP_PUBLIC_HANDOFF_MAX_BODY_BYTES', 10485760),
    allowedOrigins: getCsvEnv('MCP_PUBLIC_HANDOFF_ALLOWED_ORIGINS'),
    audit: {
      enabled: getBoolEnv('MCP_PUBLIC_HANDOFF_AUDIT_ENABLED', true),
      logPath: publicHandoffAuditLogPath
    },
    rateLimit: {
      enabled: getBoolEnv('MCP_PUBLIC_HANDOFF_RATE_LIMIT_ENABLED', true),
      perIpPerMinute: getIntEnv('MCP_PUBLIC_HANDOFF_PER_IP_PER_MINUTE', 120),
      perHandlePerMinute: getIntEnv('MCP_PUBLIC_HANDOFF_PER_HANDLE_PER_MINUTE', 60),
      postPerHandlePerMinute: getIntEnv('MCP_PUBLIC_HANDOFF_POST_PER_HANDLE_PER_MINUTE', 30),
      resultPerHandlePerMinute: getIntEnv('MCP_PUBLIC_HANDOFF_RESULT_PER_HANDLE_PER_MINUTE', 10)
    }
  },
  pgro: {
    host: getEnv('PGRO_HOST', ''),
    port: getIntEnv('PGRO_PORT', 5432),
    user: getEnv('PGRO_USER', ''),
    password: getEnv('PGRO_PASSWORD', ''),
    database: getEnv('PGRO_DB', ''),
    poolMax: getIntEnv('PGRO_POOL_MAX', 4),
    statementTimeoutMs: getIntEnv('PGRO_STATEMENT_TIMEOUT_MS', 5000)
  }
} as const;
