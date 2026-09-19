export type OperatorSignerNetwork = 'mainnet' | 'testnet' | 'devnet';

export type OperatorSignerConfig = {
  enabled: boolean;
  network?: OperatorSignerNetwork;
  chainId?: number;
  privateKey?: string;
  maxValueXgr?: number;
  maxGasLimit?: number;
  maxDataBytes?: number;
};

const DEFAULT_CHAIN_IDS: Record<OperatorSignerNetwork, number> = {
  mainnet: 1643,
  testnet: 1879,
  devnet: 1887
};

function nonNegativeNumber(raw: string | undefined, fallback: number, name: string): number {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`);
  return value;
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function operatorNetwork(raw: string | undefined): OperatorSignerNetwork {
  const value = raw?.trim();
  if (value === 'mainnet' || value === 'testnet' || value === 'devnet') return value;
  throw new Error('XGR_OPERATOR_SIGNER_NETWORK must be mainnet, testnet or devnet.');
}

export function getOperatorSignerConfig(env: NodeJS.ProcessEnv = process.env): OperatorSignerConfig {
  if (env.XGR_OPERATOR_SIGNER_ENABLED !== 'true') return { enabled: false };

  const network = operatorNetwork(env.XGR_OPERATOR_SIGNER_NETWORK);
  const chainId = positiveInteger(
    env.XGR_OPERATOR_SIGNER_CHAIN_ID,
    DEFAULT_CHAIN_IDS[network],
    'XGR_OPERATOR_SIGNER_CHAIN_ID'
  );

  const privateKey = env.XGR_OPERATOR_SIGNER_PRIVATE_KEY?.trim();
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('XGR_OPERATOR_SIGNER_PRIVATE_KEY must be a 0x-prefixed 32-byte private key.');
  }

  return {
    enabled: true,
    network,
    chainId,
    privateKey,
    maxValueXgr: nonNegativeNumber(env.XGR_OPERATOR_SIGNER_MAX_VALUE_XGR, 5, 'XGR_OPERATOR_SIGNER_MAX_VALUE_XGR'),
    maxGasLimit: positiveInteger(env.XGR_OPERATOR_SIGNER_MAX_GAS_LIMIT, 15_000_000, 'XGR_OPERATOR_SIGNER_MAX_GAS_LIMIT'),
    maxDataBytes: positiveInteger(env.XGR_OPERATOR_SIGNER_MAX_DATA_BYTES, 262_144, 'XGR_OPERATOR_SIGNER_MAX_DATA_BYTES')
  };
}
