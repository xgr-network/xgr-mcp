import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getStarterGasConfig, XGR_STARTER_GAS_GRANT_XGR } from '../src/shared/starterGasConfig.js';
import { StarterGasStore } from '../src/shared/starterGasStore.js';
import { registerStarterGasTools } from '../src/tools/starterGasTools.js';

type Tool = { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> };

const privateKey = `0x${'11'.repeat(32)}`;
const enabled = () => getStarterGasConfig({
  XGR_STARTER_GAS_ENABLED: 'true',
  XGR_STARTER_GAS_NETWORK: 'devnet',
  XGR_STARTER_GAS_CHAIN_ID: '1887',
  XGR_STARTER_GAS_PRIVATE_KEY: privateKey
});

function registered(): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  registerStarterGasTools({
    registerTool(name: string, _options: unknown, handler: Tool['handler']) { tools.set(name, { handler }); }
  } as unknown as McpServer, enabled());
  return tools;
}

function parse(value: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(value.content[0].text) as Record<string, unknown>;
}

test('starter gas remains disabled unless explicitly enabled', () => {
  assert.equal(getStarterGasConfig({}).enabled, false);
});

test('starter gas accepts mainnet, testnet and devnet with default chain ids', () => {
  const base = { XGR_STARTER_GAS_ENABLED: 'true', XGR_STARTER_GAS_PRIVATE_KEY: privateKey };
  assert.equal(getStarterGasConfig({ ...base, XGR_STARTER_GAS_NETWORK: 'mainnet' }).chainId, 1643);
  assert.equal(getStarterGasConfig({ ...base, XGR_STARTER_GAS_NETWORK: 'testnet' }).chainId, 1879);
  assert.equal(getStarterGasConfig({ ...base, XGR_STARTER_GAS_NETWORK: 'devnet' }).chainId, 1887);
});

test('starter gas validates network, private key and bounded grant policy', () => {
  assert.throws(() => getStarterGasConfig({ XGR_STARTER_GAS_ENABLED: 'true', XGR_STARTER_GAS_NETWORK: 'invalid', XGR_STARTER_GAS_PRIVATE_KEY: privateKey }), /NETWORK/);
  assert.throws(() => getStarterGasConfig({ XGR_STARTER_GAS_ENABLED: 'true', XGR_STARTER_GAS_NETWORK: 'mainnet' }), /PRIVATE_KEY/);
  assert.throws(() => getStarterGasConfig({ XGR_STARTER_GAS_ENABLED: 'true', XGR_STARTER_GAS_NETWORK: 'mainnet', XGR_STARTER_GAS_PRIVATE_KEY: privateKey, XGR_STARTER_GAS_MAX_RECIPIENT_BALANCE_XGR: '1' }), /lower than the fixed 1 XGR grant/);
  assert.throws(() => getStarterGasConfig({ XGR_STARTER_GAS_ENABLED: 'true', XGR_STARTER_GAS_NETWORK: 'mainnet', XGR_STARTER_GAS_PRIVATE_KEY: privateKey, XGR_STARTER_GAS_MAX_HOURLY_GRANTS: '101', XGR_STARTER_GAS_MAX_DAILY_GRANTS: '100' }), /must not exceed/);
  const config = enabled();
  assert.equal(config.maxRecipientBalanceXgr, 0.1);
  assert.equal(config.maxHourlyGrants, 20);
  assert.equal(config.maxDailyGrants, 100);
  assert.equal(config.maxAttemptsPerAddress, 2);
  assert.equal(config.dbPath, './data/starter-gas-grants-devnet.sqlite');
  assert.equal(XGR_STARTER_GAS_GRANT_XGR, 1);
});

test('legacy JSON path derives SQLite path for one-time migration', () => {
  const config = getStarterGasConfig({
    XGR_STARTER_GAS_ENABLED: 'true',
    XGR_STARTER_GAS_NETWORK: 'devnet',
    XGR_STARTER_GAS_PRIVATE_KEY: privateKey,
    XGR_STARTER_GAS_STORE_PATH: './data/starter-gas-grants-devnet.json'
  });
  assert.equal(config.dbPath, './data/starter-gas-grants-devnet.sqlite');
  assert.equal(config.legacyStorePath, './data/starter-gas-grants-devnet.json');
});

test('options expose a fixed one-step 1 XGR devnet grant', async () => {
  const tools = registered();
  assert.deepEqual([...tools.keys()], ['get_xgr_starter_gas_options', 'request_xgr_starter_gas']);
  const options = parse(await tools.get('get_xgr_starter_gas_options')!.handler({}));
  assert.equal(options.network, 'devnet');
  assert.equal(options.chain_id, 1887);
  assert.equal(options.grant_amount_xgr, 1);
  assert.equal(options.execution, 'direct_onchain_transfer_from_dedicated_service_wallet');
  assert.equal(options.custody_model, 'no_user_or_third_party_private_keys');
  assert.equal(options.repayment_required, false);
  assert.equal(options.next_action, 'request_xgr_starter_gas');
});

test('SQLite store reserves atomically, tracks lifecycle and permits bounded retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xgr-starter-gas-'));
  const store = new StarterGasStore(join(dir, 'grants.sqlite'));
  const address = `0x${'22'.repeat(20)}`;
  const policy = {
    address,
    amountXgr: 1,
    maxHourlyGrants: 10,
    maxDailyGrants: 20,
    maxAttemptsPerAddress: 2,
    reservationTimeoutSeconds: 600
  };

  try {
    assert.equal(store.reserve(policy).status, 'reserved');
    assert.throws(() => store.reserve(policy), /already being processed/);
    store.markFailed(address, 'pre-broadcast failure');
    assert.equal(store.reserve(policy).attemptCount, 2);
    store.markBroadcast(address, `0x${'33'.repeat(32)}`);
    assert.equal(store.get(address)?.status, 'broadcast');
    store.markConfirmed(address);
    assert.equal(store.get(address)?.status, 'confirmed');
    assert.throws(() => store.reserve(policy), /already received/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLite store imports confirmed legacy JSON grants once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xgr-starter-gas-legacy-'));
  const legacyPath = join(dir, 'grants.json');
  const dbPath = join(dir, 'grants.sqlite');
  const address = `0x${'44'.repeat(20)}`;
  writeFileSync(legacyPath, JSON.stringify({ grants: [{ address, txHash: `0x${'55'.repeat(32)}`, amountXgr: 1, createdAt: '2026-01-01T00:00:00.000Z' }] }));
  const store = new StarterGasStore(dbPath, legacyPath);

  try {
    assert.equal(store.get(address)?.status, 'confirmed');
    assert.throws(() => store.reserve({ address, amountXgr: 1, maxHourlyGrants: 10, maxDailyGrants: 20, maxAttemptsPerAddress: 2, reservationTimeoutSeconds: 600 }), /already received/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
