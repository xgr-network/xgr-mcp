import { ECDH } from 'node:crypto';
import { Interface, getAddress } from 'ethers';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../adapters/rpcClient.js';

const READKEY_ABI = ['function getReadKey(address owner) view returns (bytes pubkey)'];
const readkeyInterface = new Interface(READKEY_ABI);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function normalizeRegisteredReadkey(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value))
    throw new Error('No valid registered P-256 readkey for this wallet.');
  const point = Buffer.from(value.slice(2), 'hex');
  if (!((point.length === 33 && (point[0] === 2 || point[0] === 3))
      || (point.length === 65 && point[0] === 4)))
    throw new Error('Invalid registered P-256 readkey encoding.');
  try {
    const canonical = ECDH.convertKey(point, 'prime256v1', undefined, undefined, 'uncompressed') as Buffer;
    return `0x${canonical.toString('hex')}`;
  } catch {
    throw new Error('Registered readkey is not a valid P-256 curve point.');
  }
}

export function registerReadkeyTools(server: McpServer): void {
  server.registerTool(
    'get_xgr_public_readkey',
    {
      title: 'Get registered XGR P-256 readkey',
      description: 'Read and validate a wallet\'s PUBLIC P-256 readkey from XRC-563 using live XGR RPC. No private keys or secrets are accepted.',
      inputSchema: { walletAddress: z.string().regex(ADDRESS) }
    },
    async ({ walletAddress }) => {
      const core = await rpcCall<unknown>('xgr_getCoreAddrs');
      if (!core || typeof core !== 'object' || Array.isArray(core))
        throw new Error('XGR core-address response is invalid.');
      const rawGrants = (core as Record<string, unknown>).grants;
      if (typeof rawGrants !== 'string' || !ADDRESS.test(rawGrants))
        throw new Error('XGR Grants contract address is missing.');
      const grants = getAddress(rawGrants);
      if (grants === '0x0000000000000000000000000000000000000000')
        throw new Error('XGR Grants contract address is zero.');
      const account = getAddress(walletAddress);
      const calldata = readkeyInterface.encodeFunctionData('getReadKey', [account]);
      const result = await rpcCall<unknown>('eth_call', [{ to: grants, data: calldata }, 'latest']);
      if (typeof result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result))
        throw new Error('XGR getReadKey eth_call returned invalid ABI data.');
      const [publicBytes] = readkeyInterface.decodeFunctionResult('getReadKey', result);
      const publicKey = normalizeRegisteredReadkey(publicBytes);
      return { content: [{ type: 'text', text: JSON.stringify({ walletAddress: account, publicKey }) }] };
    }
  );
}
