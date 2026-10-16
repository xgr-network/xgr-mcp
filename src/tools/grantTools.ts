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

export function validateGrantItems(record: { items: unknown[] }, requestedRid: string, scope: 1 | 2, granteeAddress: string, now: number) {
  const normalizedRid = requestedRid.slice(2).toLowerCase();
  const grantee = granteeAddress.toLowerCase();
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
      grantee: granteeAddress,
      rights,
      expiresAt,
      encDEK
    };
  });
  return safeItems;
}

export function validateGrantSummaryItems(
  items: unknown[], expectedScope: 1 | 2, expectedRid?: string
): Array<{
  rid: string; scope: 1 | 2; owner: string; grantee: string;
  rights: number; expiresAt: number; isOwner: boolean;
  refAddr: string | null; txHash: string | null;
}> {
  return items.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Malformed XGR grant row.');
    const g = value as Record<string, unknown>;
    if (typeof g.rid !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(g.rid))
      throw new Error('Invalid XGR grant RID.');
    const normalizedRid = '0x' + g.rid.replace(/^0x/i, '').toLowerCase();
    if ((expectedRid && normalizedRid !== expectedRid.toLowerCase()) || g.scope !== expectedScope)
      throw new Error('XGR grant scope or RID differs from the query.');
    if (typeof g.owner !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(g.owner)
        || typeof g.grantee !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(g.grantee))
      throw new Error('Invalid XGR grant owner or recipient.');
    if (typeof g.rights !== 'number' || !Number.isSafeInteger(g.rights)
        || g.rights < 0 || g.rights > 7)
      throw new Error('Invalid XGR grant rights.');
    if (typeof g.expiresAt !== 'number' || !Number.isSafeInteger(g.expiresAt) || g.expiresAt < 0)
      throw new Error('Invalid XGR grant expiry.');
    if (g.isOwner !== undefined && typeof g.isOwner !== 'boolean')
      throw new Error('Invalid XGR grant owner flag.');
    const refAddr = g.refAddr === undefined || g.refAddr === null || g.refAddr === ''
      ? null : g.refAddr;
    const txHash = g.txHash === undefined || g.txHash === null || g.txHash === ''
      ? null : g.txHash;
    if (refAddr !== null && (typeof refAddr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(refAddr)))
      throw new Error('Invalid XGR grant reference address.');
    if (txHash !== null && (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)))
      throw new Error('Invalid XGR grant transaction hash.');
    // No EncDEK in UI summaries. The decrypt-only tool returns a caller-owned
    // encrypted envelope separately, after checking READ rights.
    return {
      rid: normalizedRid, scope: expectedScope,
      owner: g.owner.toLowerCase(), grantee: g.grantee.toLowerCase(),
      rights: g.rights, expiresAt: g.expiresAt, isOwner: g.isOwner === true,
      refAddr, txHash
    };
  });
}

function parseRpcGrantRows(response: unknown): unknown[] {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    throw new Error('Invalid XGR grants response.');
  const record = response as Record<string, unknown>;
  // Both keys are evidenced: XGR endpoint docs specify "items", while
  // xDaLaWeb's deployed grantsService reads "grants".
  const items = record.items;
  const grants = record.grants;
  if (items !== undefined && grants !== undefined)
    throw new Error('Ambiguous XGR grants response.');
  const rows = items !== undefined ? items : grants;
  if (!Array.isArray(rows)) throw new Error('Missing XGR grant rows.');
  return rows;
}

type SignedPermit = z.infer<typeof permit>;
async function assertAuthorizedPermit(signedPermit: SignedPermit): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  if (signedPermit.message.expiry <= now || signedPermit.message.expiry > now + 300)
    throw new Error('Grant permit must be valid for at most five minutes.');
  if (!exactFields(signedPermit.types.EIP712Domain, DOMAIN_FIELDS)
      || !exactFields(signedPermit.types.xdalaPermit, PERMIT_FIELDS))
    throw new Error('Unexpected xdalaPermit EIP-712 type layout.');
  const chainHex = await rpcCall<string>('eth_chainId');
  if (typeof chainHex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chainHex))
    throw new Error('XGR RPC returned invalid chain ID.');
  if (Number(BigInt(chainHex)) !== signedPermit.domain.chainId)
    throw new Error('xdalaPermit chain ID does not match the connected RPC.');
  return now;
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
      const now = await assertAuthorizedPermit(signedPermit);
      const rows = parseRpcGrantRows(await rpcCall('xgr_listGrants', [{
        scope, rid: requestedRid, validAt: now, limit, permit: signedPermit
      }]));
      // Owners may also receive grants for other recipients. Only their own
      // READ grant can be used by the decrypt path.
      const mine = rows.filter((value) =>
        value && typeof value === 'object' && !Array.isArray(value)
        && typeof (value as Record<string, unknown>).grantee === 'string'
        && ((value as Record<string, unknown>).grantee as string).toLowerCase() === signedPermit.message.from.toLowerCase()
      );
      if (mine.length !== 1)
        throw new Error('Expected exactly one caller-owned XGR READ grant.');
      const safeItems = validateGrantItems({ items: mine }, requestedRid, scope, signedPermit.message.from, now);
      return { content: [{ type: 'text', text: JSON.stringify({ rid: requestedRid, scope, grantee: signedPermit.message.from, items: safeItems }) }] };
    }
  );
  server.registerTool(
    'list_xgr_grants',
    {
      title: 'List XGR grants for Manage Grants',
      description: 'List grants visible to the permit signer, optionally filtered by RID. This tool returns only grant metadata, never private keys, plaintext or EncDEK. XGR RPC authorizes which recipients may be listed based on the signed permit.',
      inputSchema: {
        scope: z.union([z.literal(1), z.literal(2)]),
        rid: rid.optional(),
        permit,
        limit: z.number().int().min(1).max(100).default(100)
      }
    },
    async ({ scope, rid: requestedRid, permit: signedPermit, limit }) => {
      const now = await assertAuthorizedPermit(signedPermit);
      const request = {
        scope,
        ...(requestedRid ? { rid: requestedRid } : {}),
        limit,
        permit: signedPermit
      };
      const rows = parseRpcGrantRows(await rpcCall('xgr_listGrants', [request]));
      const grants = validateGrantSummaryItems(rows, scope, requestedRid);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ scope, wallet: signedPermit.message.from, grants })
        }]
      };
    }
  );

}
