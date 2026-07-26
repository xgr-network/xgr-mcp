export const XGR_STARTER_GAS_GRANT_XGR = 1;

export type StarterGasNetwork = 'mainnet' | 'testnet' | 'devnet';

export type StarterGasConfig = {
  enabled: boolean;
  network?: StarterGasNetwork;
  chainId?: number;
  privateKey?: string;
  maxRecipientBalanceXgr?: number;
  maxHourlyGrants?: number;
  maxDailyGrants?: number;
  maxAttemptsPerAddress?: number;
  reservationTimeoutSeconds?: number;
  dbPath?: string;
  legacyStorePath?: string;
};

const DEFAULT_CHAIN_IDS: Record<StarterGasNetwork, number> = {
  mainnet: 1643,
  testnet: 1879,
  devnet: 1887
};

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  const value = positiveNumber(raw, fallback, name);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

function starterGasNetwork(raw: string | undefined): StarterGasNetwork {
  const value = raw?.trim();
  if (value === 'mainnet' || value === 'testnet' || value === 'devnet') return value;
  throw new Error('XGR_STARTER_GAS_NETWORK must be mainnet, testnet or devnet.');
}

function sqlitePath(network: StarterGasNetwork, env: NodeJS.ProcessEnv): { dbPath: string; legacyStorePath?: string } {
  const configuredDbPath = env.XGR_STARTER_GAS_DB_PATH?.trim();
  if (configuredDbPath) return { dbPath: configuredDbPath };

  const legacyStorePath = env.XGR_STARTER_GAS_STORE_PATH?.trim();
  if (legacyStorePath) {
    const dbPath = legacyStorePath.toLowerCase().endsWith('.json')
      ? legacyStorePath.slice(0, -5) + '.sqlite'
      : legacyStorePath;
    return { dbPath, legacyStorePath: legacyStorePath.toLowerCase().endsWith('.json') ? legacyStorePath : undefined };
  }

  return { dbPath: `./data/starter-gas-grants-${network}.sqlite` };
}

export function getStarterGasConfig(env: NodeJS.ProcessEnv = process.env): StarterGasConfig {
  if (env.XGR_STARTER_GAS_ENABLED !== 'true') return { enabled: false };

  const network = starterGasNetwork(env.XGR_STARTER_GAS_NETWORK);
  const chainId = positiveInteger(env.XGR_STARTER_GAS_CHAIN_ID, DEFAULT_CHAIN_IDS[network], 'XGR_STARTER_GAS_CHAIN_ID');

  const privateKey = env.XGR_STARTER_GAS_PRIVATE_KEY?.trim();
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('XGR_STARTER_GAS_PRIVATE_KEY must be a 0x-prefixed 32-byte private key.');
  }

  const maxRecipientBalanceXgr = positiveNumber(env.XGR_STARTER_GAS_MAX_RECIPIENT_BALANCE_XGR, 0.1, 'XGR_STARTER_GAS_MAX_RECIPIENT_BALANCE_XGR');
  if (maxRecipientBalanceXgr >= XGR_STARTER_GAS_GRANT_XGR) {
    throw new Error('XGR_STARTER_GAS_MAX_RECIPIENT_BALANCE_XGR must be lower than the fixed 1 XGR grant.');
  }

  const maxHourlyGrants = positiveInteger(env.XGR_STARTER_GAS_MAX_HOURLY_GRANTS, 20, 'XGR_STARTER_GAS_MAX_HOURLY_GRANTS');
  const maxDailyGrants = positiveInteger(env.XGR_STARTER_GAS_MAX_DAILY_GRANTS, 100, 'XGR_STARTER_GAS_MAX_DAILY_GRANTS');
  if (maxHourlyGrants > maxDailyGrants) throw new Error('XGR_STARTER_GAS_MAX_HOURLY_GRANTS must not exceed XGR_STARTER_GAS_MAX_DAILY_GRANTS.');

  const paths = sqlitePath(network, env);

  return {
    enabled: true,
    network,
    chainId,
    privateKey,
    maxRecipientBalanceXgr,
    maxHourlyGrants,
    maxDailyGrants,
    maxAttemptsPerAddress: positiveInteger(env.XGR_STARTER_GAS_MAX_ATTEMPTS_PER_ADDRESS, 2, 'XGR_STARTER_GAS_MAX_ATTEMPTS_PER_ADDRESS'),
    reservationTimeoutSeconds: positiveInteger(env.XGR_STARTER_GAS_RESERVATION_TIMEOUT_SECONDS, 600, 'XGR_STARTER_GAS_RESERVATION_TIMEOUT_SECONDS'),
    ...paths
  };
}
