import { JsonRpcProvider, Wallet, formatEther, getAddress, parseEther } from 'ethers';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { env } from '../config/env.js';
import type { OperatorSignerConfig } from '../shared/operatorSignerConfig.js';

const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

function requireConfig(config: OperatorSignerConfig): Required<OperatorSignerConfig> {
  if (
    !config.enabled || !config.network || !config.chainId || !config.privateKey ||
    config.maxValueXgr === undefined || !config.maxGasLimit || !config.maxDataBytes
  ) throw new Error('Operator signer is not fully configured.');
  return config as Required<OperatorSignerConfig>;
}

function normalizeHexData(data: string | undefined): string {
  if (!data) return '0x';
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) throw new Error('data must be 0x-prefixed even-length hexadecimal bytes.');
  return data;
}

function dataBytes(data: string): number {
  return Math.max(0, (data.length - 2) / 2);
}

export function registerOperatorSignerTools(server: McpServer, rawConfig: OperatorSignerConfig): void {
  if (!rawConfig.enabled) return;
  const config = requireConfig(rawConfig);

  server.registerTool('get_xgr_operator_wallet_status', {
    title: 'Get XGR operator wallet status',
    description: 'Read the dedicated server-side XGR operator wallet address, balance, nonce and active transaction policy. The private key is never returned.',
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, async () => {
    const provider = new JsonRpcProvider(env.rpcUrl);
    const wallet = new Wallet(config.privateKey, provider);
    const remoteChainId = Number((await provider.getNetwork()).chainId);
    if (remoteChainId !== config.chainId) throw new Error(`RPC chain id ${remoteChainId} does not match configured ${config.network} chain id ${config.chainId}.`);
    const [balance, nonce] = await Promise.all([
      provider.getBalance(wallet.address),
      provider.getTransactionCount(wallet.address, 'pending')
    ]);
    return result({
      enabled: true,
      network: config.network,
      chain_id: config.chainId,
      address: wallet.address,
      balance_xgr: formatEther(balance),
      pending_nonce: nonce,
      policy: {
        max_value_xgr_per_transaction: config.maxValueXgr,
        max_gas_limit: config.maxGasLimit,
        max_data_bytes: config.maxDataBytes,
        contract_creation_allowed: true,
        arbitrary_evm_call_allowed: true
      }
    });
  });

  server.registerTool('send_xgr_operator_transaction', {
    title: 'Send XGR operator transaction',
    description: 'Sign and submit one EVM transaction from the dedicated server-side XGR operator wallet. Supports native XGR transfers, contract calls and contract creation. It never accepts a private key from the caller and is bounded by server-side chain, value, gas and calldata limits.',
    inputSchema: {
      to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
      valueXgr: z.number().min(0).optional(),
      data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).optional(),
      gasLimit: z.number().int().positive().optional(),
      purpose: z.string().trim().min(1).max(500)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async input => {
    const provider = new JsonRpcProvider(env.rpcUrl);
    const wallet = new Wallet(config.privateKey, provider);
    const remoteChainId = Number((await provider.getNetwork()).chainId);
    if (remoteChainId !== config.chainId) throw new Error(`RPC chain id ${remoteChainId} does not match configured ${config.network} chain id ${config.chainId}.`);

    const data = normalizeHexData(input.data);
    if (dataBytes(data) > config.maxDataBytes) throw new Error(`Transaction data exceeds configured maximum of ${config.maxDataBytes} bytes.`);

    const valueXgr = input.valueXgr ?? 0;
    if (valueXgr > config.maxValueXgr) throw new Error(`Transaction value exceeds configured maximum of ${config.maxValueXgr} XGR.`);

    if (!input.to && data === '0x') throw new Error('Contract creation requires non-empty bytecode in data.');
    const to = input.to ? getAddress(input.to) : undefined;
    const gasLimit = input.gasLimit;
    if (gasLimit !== undefined && gasLimit > config.maxGasLimit) {
      throw new Error(`gasLimit exceeds configured maximum of ${config.maxGasLimit}.`);
    }

    const txRequest = {
      ...(to ? { to } : {}),
      value: parseEther(String(valueXgr)),
      data,
      ...(gasLimit !== undefined ? { gasLimit } : {})
    };

    const estimatedGas = await provider.estimateGas({ from: wallet.address, ...txRequest });
    if (estimatedGas > BigInt(config.maxGasLimit)) {
      throw new Error(`Estimated gas ${estimatedGas.toString()} exceeds configured maximum of ${config.maxGasLimit}.`);
    }

    const senderBalance = await provider.getBalance(wallet.address);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    const worstCaseCost = parseEther(String(valueXgr)) + estimatedGas * gasPrice;
    if (senderBalance < worstCaseCost) throw new Error('Operator wallet balance is insufficient for value plus estimated transaction fee.');

    const tx = await wallet.sendTransaction(txRequest);
    const receipt = await tx.wait(1);
    if (!receipt) return result({
      submitted: true,
      confirmed: false,
      transaction_hash: tx.hash,
      purpose: input.purpose,
      next_action: 'check_transaction_receipt'
    });

    return result({
      submitted: true,
      confirmed: receipt.status === 1,
      status: receipt.status,
      network: config.network,
      chain_id: config.chainId,
      from: wallet.address,
      to: to ?? null,
      contract_address: receipt.contractAddress ?? null,
      value_xgr: valueXgr,
      gas_used: receipt.gasUsed.toString(),
      transaction_hash: tx.hash,
      block_number: receipt.blockNumber,
      purpose: input.purpose
    });
  });
}
