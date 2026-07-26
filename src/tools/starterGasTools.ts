import { JsonRpcProvider, Wallet, formatEther, getAddress, parseEther } from 'ethers';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { env } from '../config/env.js';
import type { StarterGasConfig } from '../shared/starterGasConfig.js';
import { XGR_STARTER_GAS_GRANT_XGR } from '../shared/starterGasConfig.js';
import { getMcpRequestContext } from '../shared/requestContext.js';
import { StarterGasStore } from '../shared/starterGasStore.js';

const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

export function registerStarterGasTools(server: McpServer, config: StarterGasConfig): void {
  if (
    !config.enabled || !config.network || !config.chainId || !config.privateKey || !config.dbPath ||
    !config.maxHourlyGrants || !config.maxDailyGrants || !config.maxRequestsPerIpHour ||
    !config.maxRequestsPerIpDay || !config.maxAttemptsPerAddress ||
    !config.reservationTimeoutSeconds || config.maxRecipientBalanceXgr === undefined
  ) return;

  server.registerTool('get_xgr_starter_gas_options', {
    title: 'Get XGR starter gas options',
    description: 'Check whether free native XGR starter gas is available for a low-balance EVM address. Use this before deployments, session starts, contract calls or other on-chain actions when the address lacks gas. Returns the fixed 1 XGR grant policy and the tool to call next.',
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, async () => result({
    network: config.network,
    chain_id: config.chainId,
    grant_amount_xgr: XGR_STARTER_GAS_GRANT_XGR,
    maximum_recipient_balance_xgr: config.maxRecipientBalanceXgr,
    one_grant_per_address: true,
    max_hourly_grants: config.maxHourlyGrants,
    max_daily_grants: config.maxDailyGrants,
    max_requests_per_client_ip_hour: config.maxRequestsPerIpHour,
    max_requests_per_client_ip_day: config.maxRequestsPerIpDay,
    maximum_attempts_per_address: config.maxAttemptsPerAddress,
    execution: 'direct_onchain_transfer_from_dedicated_service_wallet',
    custody_model: 'no_user_or_third_party_private_keys',
    repayment_required: false,
    next_action: 'request_xgr_starter_gas'
  }));

  server.registerTool('request_xgr_starter_gas', {
    title: 'Request XGR starter gas',
    description: 'Use this tool when a user or agent needs native XGR to pay transaction fees on the configured XGR network. It sends one fixed 1 XGR grant from a dedicated server-controlled funding wallet to an eligible low-balance EVM address. Use it before deployments, session starts, contract calls or other on-chain actions when the address lacks gas. One confirmed grant per address; client-IP request limits apply; no repayment is required. The service never requests, receives or stores user or third-party private keys and cannot sign on behalf of users.',
    inputSchema: {
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      purpose: z.string().trim().min(1).max(120).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async input => {
    const address = getAddress(input.address);
    const provider = new JsonRpcProvider(env.rpcUrl);
    const store = new StarterGasStore(config.dbPath!, config.legacyStorePath);
    let reserved = false;
    let txHash: string | undefined;
    let confirmedFailure = false;

    try {
      const clientIp = getMcpRequestContext().clientIp;
      if (clientIp) {
        store.consumeIpRequest(clientIp, config.maxRequestsPerIpHour!, config.maxRequestsPerIpDay!);
      }

      const remoteChainIdHex = await provider.send('eth_chainId', []);
      const remoteChainId = Number(BigInt(String(remoteChainIdHex)));
      if (remoteChainId !== config.chainId) throw new Error(`RPC chain id ${remoteChainId} does not match configured ${config.network} chain id ${config.chainId}.`);

      const existing = store.get(address);
      if (existing?.status === 'broadcast' && existing.txHash) {
        const existingReceipt = await provider.getTransactionReceipt(existing.txHash);
        if (!existingReceipt) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({
              grant_created: false,
              grant_status: 'broadcast',
              transaction_hash: existing.txHash,
              retry_allowed: false,
              error: { message: 'A starter-gas transaction for this address is already broadcast and still awaiting confirmation.' }
            }) }]
          };
        }
        if (existingReceipt.status === 1) store.markConfirmed(address);
        else store.markFailed(address, `Starter-gas transaction ${existing.txHash} was confirmed with failure status.`);
      }

      const balance = await provider.getBalance(address);
      const maxBalance = parseEther(String(config.maxRecipientBalanceXgr));
      if (balance > maxBalance) throw new Error(`Recipient balance exceeds the ${config.maxRecipientBalanceXgr} XGR eligibility limit.`);

      const wallet = new Wallet(config.privateKey!, provider);
      const amount = parseEther(String(XGR_STARTER_GAS_GRANT_XGR));
      const senderBalance = await provider.getBalance(wallet.address);
      if (senderBalance <= amount) throw new Error('Starter-gas wallet balance is insufficient for the 1 XGR grant plus transaction fees.');

      store.reserve({
        address,
        amountXgr: XGR_STARTER_GAS_GRANT_XGR,
        purpose: input.purpose,
        maxHourlyGrants: config.maxHourlyGrants!,
        maxDailyGrants: config.maxDailyGrants!,
        maxAttemptsPerAddress: config.maxAttemptsPerAddress!,
        reservationTimeoutSeconds: config.reservationTimeoutSeconds!
      });
      reserved = true;

      const tx = await wallet.sendTransaction({ to: address, value: amount });
      txHash = tx.hash;
      store.markBroadcast(address, tx.hash);

      const receipt = await tx.wait(1);
      if (!receipt) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({
            grant_created: false,
            grant_status: 'broadcast',
            transaction_hash: tx.hash,
            retry_allowed: false,
            error: { message: 'Starter-gas transaction was broadcast but confirmation is still pending.' }
          }) }]
        };
      }
      if (receipt.status !== 1) {
        confirmedFailure = true;
        const message = `Starter-gas transaction ${tx.hash} was confirmed with failure status.`;
        store.markFailed(address, message);
        throw new Error(message);
      }

      store.markConfirmed(address);
      return result({
        network: config.network,
        chain_id: config.chainId,
        grant_created: true,
        grant_status: 'confirmed',
        recipient: address,
        previous_balance_xgr: formatEther(balance),
        amount_xgr: XGR_STARTER_GAS_GRANT_XGR,
        transaction_hash: tx.hash,
        block_number: receipt.blockNumber,
        next_action: 'starter_gas_ready',
        repeat_allowed: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (reserved && !txHash) store.markFailed(address, message);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify({
          grant_created: false,
          grant_status: confirmedFailure ? 'failed' : txHash ? 'broadcast' : reserved ? 'failed' : 'not_reserved',
          amount_xgr: XGR_STARTER_GAS_GRANT_XGR,
          transaction_hash: txHash,
          retry_allowed: reserved && (!txHash || confirmedFailure),
          error: { message }
        }) }]
      };
    } finally {
      store.close();
    }
  });
}
