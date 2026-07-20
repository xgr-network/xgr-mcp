import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerChainTools } from '../src/tools/chainTools.js';
import { registerXrcExecutorTools } from '../src/tools/xrcExecutorTools.js';

type RegisteredTool = {
  options: Record<string, unknown>;
  handler: (...args: unknown[]) => Promise<Record<string, unknown>>;
};

function captureTools(register: (server: McpServer) => void): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, options: Record<string, unknown>, handler: RegisteredTool['handler']) {
      tools.set(name, { options, handler });
    }
  } as unknown as McpServer;
  register(server);
  return tools;
}

function parseTextResult(result: Record<string, unknown>): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  assert.equal(content[0]?.type, 'text');
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
}

test('get_xgr_network_info exposes canonical official metadata and links', async () => {
  const tools = captureTools(registerChainTools);
  const tool = tools.get('get_xgr_network_info');
  assert(tool);

  const payload = parseTextResult(await tool.handler({}));
  assert.equal(payload.schemaVersion, 'xgr-network-info@1');

  const project = payload.project as Record<string, unknown>;
  const chain = payload.chain as Record<string, unknown>;
  const mainnet = chain.mainnet as Record<string, unknown>;
  const networks = payload.networks as Record<string, Record<string, unknown>>;
  const links = payload.links as Record<string, unknown>;

  assert.equal(project.name, 'XGR.Network');
  assert.equal(chain.name, 'XGRChain');
  assert.equal(mainnet.chainId, 1643);
  assert.equal(networks.mainnet.rpc, 'https://rpc.xgr.network');
  assert.equal(networks.mainnet.explorer, 'https://explorer.xgr.network');
  assert.equal(networks.mainnet.mcp, 'https://mcp.xgr.network/mcp');
  assert.equal(networks.testnet.faucet, 'https://faucet.xgr.network');
  assert.equal(Object.hasOwn(networks, 'devnet'), false);
  assert.equal(links.faucet, 'https://faucet.xgr.network');
  assert.equal(links.website, 'https://xgr.network');
  assert.equal(links.github, 'https://github.com/xgr-network');
});

test('executor relation tool limits public requests to Explorer maximum', () => {
  const tools = captureTools(registerXrcExecutorTools);
  const tool = tools.get('list_xrc729_contracts_by_executor');
  assert(tool);

  const inputSchema = tool.options.inputSchema as Record<string, { safeParse: (value: unknown) => { success: boolean } }>;
  assert.equal(inputSchema.limit.safeParse(100).success, true);
  assert.equal(inputSchema.limit.safeParse(101).success, false);
});
