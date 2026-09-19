import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getOperatorSignerConfig } from '../src/shared/operatorSignerConfig.js';
import { registerOperatorSignerTools } from '../src/tools/operatorSignerTools.js';

type Tool = { handler: (input: Record<string, unknown>) => Promise<unknown> };
const privateKey = `0x${'11'.repeat(32)}`;

test('operator signer remains disabled unless explicitly enabled', () => {
  assert.equal(getOperatorSignerConfig({}).enabled, false);
});

test('operator signer validates dedicated private key and chain configuration', () => {
  assert.throws(() => getOperatorSignerConfig({
    XGR_OPERATOR_SIGNER_ENABLED: 'true',
    XGR_OPERATOR_SIGNER_NETWORK: 'mainnet'
  }), /PRIVATE_KEY/);

  assert.throws(() => getOperatorSignerConfig({
    XGR_OPERATOR_SIGNER_ENABLED: 'true',
    XGR_OPERATOR_SIGNER_NETWORK: 'invalid',
    XGR_OPERATOR_SIGNER_PRIVATE_KEY: privateKey
  }), /NETWORK/);

  const config = getOperatorSignerConfig({
    XGR_OPERATOR_SIGNER_ENABLED: 'true',
    XGR_OPERATOR_SIGNER_NETWORK: 'mainnet',
    XGR_OPERATOR_SIGNER_PRIVATE_KEY: privateKey
  });

  assert.equal(config.chainId, 1643);
  assert.equal(config.maxValueXgr, 5);
  assert.equal(config.maxGasLimit, 15_000_000);
  assert.equal(config.maxDataBytes, 262_144);
});

test('operator signer registers status and bounded transaction tools when enabled', () => {
  const tools = new Map<string, Tool>();
  const server = {
    registerTool(name: string, _options: unknown, handler: Tool['handler']) {
      tools.set(name, { handler });
    }
  } as unknown as McpServer;

  registerOperatorSignerTools(server, getOperatorSignerConfig({
    XGR_OPERATOR_SIGNER_ENABLED: 'true',
    XGR_OPERATOR_SIGNER_NETWORK: 'mainnet',
    XGR_OPERATOR_SIGNER_PRIVATE_KEY: privateKey
  }));

  assert.deepEqual([...tools.keys()], [
    'get_xgr_operator_wallet_status',
    'send_xgr_operator_transaction'
  ]);
});
