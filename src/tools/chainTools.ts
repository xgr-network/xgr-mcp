import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../adapters/rpcClient.js';
import { getPurchaseConfig } from '../shared/purchaseConfig.js';

const XGR_MAINNET_CHAIN_ID = 1643;
const XGR_MAINNET_CHAIN_ID_HEX = '0x66b';

const XGR_NETWORK_INFO = {
  schemaVersion: 'xgr-network-info@1',
  source: 'official_xgr_network_metadata',
  project: {
    name: 'XGR.Network',
    company: 'XGR.Network GmbH',
    tagline: 'Blockchain Was the Transport. XDaLa Is the Logic.',
    description: 'XGR.Network develops XGRChain and XDaLa for deterministic, auditable on-chain process execution.'
  },
  chain: {
    name: 'XGRChain',
    layer: 'Layer 1',
    evmCompatible: true,
    mainnet: {
      chainId: XGR_MAINNET_CHAIN_ID,
      chainIdHex: XGR_MAINNET_CHAIN_ID_HEX,
      nativeCurrency: {
        name: 'XGR',
        symbol: 'XGR',
        decimals: 18
      }
    }
  },
  xdala: {
    name: 'XDaLa',
    expandedName: 'XGR Data Layer',
    description: 'A deterministic validation-to-execution engine for auditable on-chain rules and workflows.'
  },
  standards: {
    xrc137: 'Single-step smart-contract JSON rule specification for validation and execution.',
    xrc729: 'Multi-step orchestration and session-management standard for XDaLa workflows.'
  },
  networks: {
    mainnet: {
      rpc: 'https://rpc.xgr.network',
      explorer: 'https://explorer.xgr.network',
      mcp: 'https://mcp.xgr.network/mcp'
    },
    testnet: {
      rpc: 'https://rpc1.testnet.xgr.network',
      explorer: 'https://explorer.testnet.xgr.network',
      mcp: 'https://mcp.testnet.xgr.network/mcp',
      faucet: 'https://faucet.xgr.network'
    }
  },
  links: {
    website: 'https://xgr.network',
    documentation: 'https://xgr.network/docs/',
    faucet: 'https://faucet.xgr.network',
    mcpOverview: 'https://xgr.network/docs/mcp_overview/',
    mcpTools: 'https://xgr.network/docs/mcp_tools/',
    mcpHandoff: 'https://xgr.network/docs/mcp_handoff/',
    mcpAuthoring: 'https://xgr.network/docs/mcp_knowledge/',
    github: 'https://github.com/xgr-network'
  },
  discovery: {
    officialMcpRegistryName: 'io.github.xgr-network/xdala-workflow-builder',
    smithery: 'https://smithery.ai/servers/xgrnetwork/xdala-workflow-builder'
  }
} as const;

function textJson(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function parseHexQuantity(value: string): number | string {
  try {
    const parsed = BigInt(value);
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : parsed.toString();
  } catch {
    return value;
  }
}

export function registerChainTools(server: McpServer): void {
  server.registerTool(
    'get_xgr_network_info',
    {
      title: 'Get official XGR.Network information',
      description: 'Use this when the user asks what XGR.Network, XGRChain or XDaLa is, or requests official XGR URLs, chain metadata, RPC, Explorer, MCP, testnet faucet, documentation, XRC standards, source repositories or ecosystem entry points. Returns canonical project metadata and links; use get_chain_status for live chain state.',
      inputSchema: {}
    },
    async () => {
      const purchase = getPurchaseConfig();
      return textJson({ ...XGR_NETWORK_INFO, purchase: purchase.enabled ? { supported: true, network: 'mainnet', tools_enabled: true, autonomous_max_eur: purchase.maxEur, billing_address_threshold_eur: 250, payment_execution: 'external' } : { supported: false, tools_enabled: false } });
    }
  );

  server.registerTool(
    'get_chain_status',
    {
      title: 'Get XGRChain status',
      description: 'Use this for live XGRChain status. Returns chain id, latest block number and gas price from JSON-RPC, plus official XGR.Network entry points for the connected mainnet.',
      inputSchema: {}
    },
    async () => {
      const [chainId, blockNumber, gasPrice] = await Promise.all([
        rpcCall<string>('eth_chainId'),
        rpcCall<string>('eth_blockNumber'),
        rpcCall<string>('eth_gasPrice')
      ]);
      const chainIdDecimal = parseHexQuantity(chainId);
      const isMainnet = chainIdDecimal === XGR_MAINNET_CHAIN_ID;

      return textJson({
        network: {
          name: 'XGRChain',
          chainId,
          chainIdDecimal,
          nativeCurrency: XGR_NETWORK_INFO.chain.mainnet.nativeCurrency,
          ...(isMainnet ? { environment: 'mainnet' } : {})
        },
        blockNumber,
        blockNumberDecimal: parseHexQuantity(blockNumber),
        gasPrice,
        gasPriceWei: parseHexQuantity(gasPrice),
        links: {
          website: XGR_NETWORK_INFO.links.website,
          documentation: XGR_NETWORK_INFO.links.documentation,
          ...(isMainnet ? XGR_NETWORK_INFO.networks.mainnet : {}),
          networkInfoTool: 'get_xgr_network_info'
        }
      });
    }
  );

  server.registerTool(
    'get_latest_block',
    {
      title: 'Get latest block',
      description: 'Use this when the user asks for the latest EVM block details from XGRChain.',
      inputSchema: {}
    },
    async () => {
      const block = await rpcCall<unknown>('eth_getBlockByNumber', ['latest', true]);
      return textJson(block);
    }
  );

  server.registerTool(
    'get_account_live_state',
    {
      title: 'Get account live state',
      description: 'Use this for live EVM account state. Returns balance, nonce and contract code for an address.',
      inputSchema: {
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      }
    },
    async ({ address }) => {
      const [balance, nonce, code] = await Promise.all([
        rpcCall<string>('eth_getBalance', [address, 'latest']),
        rpcCall<string>('eth_getTransactionCount', [address, 'latest']),
        rpcCall<string>('eth_getCode', [address, 'latest'])
      ]);

      return textJson({ address, balance, nonce, isContract: code !== '0x', code });
    }
  );
}
