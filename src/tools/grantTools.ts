import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../adapters/rpcClient.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const rid = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

// Exact XDaLa EIP-712 permit structure. No private keys, mnemonics or plaintext.
const permit = z.object({
  domain: z.object({
    name: z.literal('XDaLa Control'),
    version: z.literal('1'),
    chainId: z.number().int().positive()
  }).strict(),
  primaryType: z.literal('xdalaPermit'),
  types: z.object({
    EIP712Domain: z.array(z.object({ name: z.string(), type: z.string() }).strict()),
    xdalaPermit: z.array(z.object({ name: z.string(), type: z.string() }).strict())
  }).strict(),
  message: z.object({
    from: address,
    expiry: z.number().int().positive()
  }).strict(),
  signature
}).strict();

const DOMAIN_FIELDS = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }];
const PERMIT_FIELDS = [{ name: 'from', type: 'address' }, { name: 'expiry', type: 'uint256' }];
function exactFields(actual: Array<{ name: string; type: string }>, expected: typeof DOMAIN_FIELDS): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function registerGrantTools(server: McpServer): void {
  server.registerTool(
    'list_xgr_grants_for_readkey',
    {
      title: 'List authorized XGR encrypted grants',
      description: 'Read XGR grants for a specific RID and scope using a caller-signed short-lived xdalaPermit. Returns encrypted DEK envelopes only. The RPC validates the signature and access rights; callers must additionally validate grants and their own user permissions before local decryption. No private keys or plaintext accepted.',
      inputSchema: {
        rid,
        scope: z.union([z.literal(1), z.literal(2)]),
        permit,
        limit: z.number().int().min(1).max(100).default(100)
      }
    },
    async ({ rid: requestedRid, scope, permit: signedPermit, limit }) => {
      const now = Math.floor(Date.now() / 1000);
      if (signedPermit.message.expiry <= now || signedPermit.message.expiry > now + 300)
        throw new Error('Grant read permit must be valid for at most five minutes.');
      if (!exactFields(signedPermit.types.EIP712Domain, DOMAIN_FIELDS)
          || !exactFields(signedPermit.types.xdalaPermit, PERMIT_FIELDS))
        throw new Error('Unexpected xdalaPermit EIP-712 type layout.');

      // Verify RPC chain before submitting the signed permit.
      const chainHex = await rpcCall<string>('eth_chainId');
      if (typeof chainHex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chainHex))
        throw new Error('XGR RPC returned invalid chain ID.');
      if (Number(BigInt(chainHex)) !== signedPermit.domain.chainId)
        throw new Error('xdalaPermit chain ID does not match the connected RPC.');

      // The gateway does not determine who is allowed to decrypt.
      // Access verification is performed by the XGR RPC and, independently,
      // by the consuming backend's authenticated session/assignment checks.
      const response: unknown = await rpcCall('xgr_listGrants', [{
        scope,
        rid: requestedRid,
        validAt: now,
        limit,
        permit: signedPermit
      }]);
      if (!response || typeof response !== 'object' || Array.isArray(response))
        throw new Error('Invalid XGR grants response.');
      const record = response as Record<string, unknown>;
      if (!Array.isArray(record.items)) throw new Error('Missing XGR grant items.');
      const normalizedRid = requestedRid.slice(2).toLowerCase();
      const grantee = signedPermit.message.from.toLowerCase();
      const safeItems = record.items.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          throw new Error('Malformed grant item.');
        const grant = item as Record<string, unknown>;
        const itemRid = typeof grant.rid === 'string' ? grant.rid.replace(/^0x/i, '').toLowerCase() : '';
        const itemScope = grant.scope;
        const itemGrantee = typeof grant.grantee === 'string' ? grant.grantee.toLowerCase() : '';
        const rights = grant.rights;
        const expiresAt = grant.expiresAt;
        const encDEK = grant.encDEK;
        if (itemRid !== normalizedRid || itemScope !== scope || itemGrantee !== grantee
            || !Number.isSafeInteger(rights) || typeof rights !== 'number' || (rights & 1) !== 1
            || !Number.isSafeInteger(expiresAt) || typeof expiresAt !== 'number'
            || (expiresAt !== 0 && expiresAt <= now)
            || typeof encDEK !== 'string' || !/^0x[0-9a-fA-F]{282}$/.test(encDEK))
          throw new Error('Grant does not match the requested wallet, scope, RID, READ access or expiry.');
        return {
          rid: requestedRid,
          scope,
          grantee: signedPermit.message.from,
          rights,
          expiresAt,
          encDEK
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ rid: requestedRid, scope, grantee: signedPermit.message.from, items: safeItems }) }] };
    }
  );
}
