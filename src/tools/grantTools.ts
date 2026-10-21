import { ECDH } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rpcCall } from '../adapters/rpcClient.js';
import { env } from '../config/env.js';

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

const ENCRYPTED_DEK = /^0x[0-9a-fA-F]{282}$/;
const REVOKED_DEK = '0x' + '00'.repeat(141);

export interface XgrGrantWriteEntry {
  grantee: string;
  rights: number;
  expireAt: number;
  encDEK: string;
  isOwner?: boolean;
}

/** Validate an untrusted request before forwarding any mutation to XGR RPC. */
export function validateGrantWriteEntries(
  entries: readonly XgrGrantWriteEntry[], owner: string, now: number
): XgrGrantWriteEntry[] {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 20)
    throw new Error('Grant mutation requires 1-20 entries.');
  const seen = new Set<string>();
  return entries.map((entry) => {
    const recipient = entry.grantee.toLowerCase();
    if (seen.has(recipient)) throw new Error('Duplicate grant recipient.');
    seen.add(recipient);
    if (typeof entry.rights !== 'number' || !Number.isSafeInteger(entry.rights)
      || entry.rights < 0 || entry.rights > 7)
      throw new Error('Grant rights must be a bitmask from 0 to 7.');
    if (typeof entry.expireAt !== 'number' || !Number.isSafeInteger(entry.expireAt)
      || entry.expireAt < 0)
      throw new Error('Invalid grant expiry.');
    if (typeof entry.encDEK !== 'string' || !ENCRYPTED_DEK.test(entry.encDEK))
      throw new Error('Grant EncDEK must contain exactly 141 bytes.');
    const ownGrant = recipient === owner.toLowerCase();
    if (entry.isOwner === true && !ownGrant)
      throw new Error('Cannot mark a different wallet as the grant owner.');
    if (ownGrant && (entry.isOwner !== true || (entry.rights & 4) !== 4))
      throw new Error('Cannot revoke the owner grant or remove owner MANAGE rights.');
    if (entry.rights === 0) {
      if (entry.expireAt !== 0 || entry.encDEK.toLowerCase() !== REVOKED_DEK)
        throw new Error('Revocation requires expiry=0 and a zeroed EncDEK.');
    } else {
      if (entry.expireAt !== 0 && entry.expireAt <= now)
        throw new Error('Active grants cannot be created already expired.');
      const packed = Buffer.from(entry.encDEK.slice(2), 'hex');
      if (packed[0] !== 4) throw new Error('Active EncDEK must use P-256 mode 4.');
      try {
        ECDH.convertKey(packed.subarray(0, 65), 'prime256v1', undefined, undefined, 'uncompressed');
      } catch { throw new Error('EncDEK contains an invalid ephemeral P-256 public key.'); }
    }
    return {
      grantee: recipient,
      rights: entry.rights,
      expireAt: entry.expireAt,
      encDEK: entry.encDEK.toLowerCase(),
      ...(entry.isOwner === true ? { isOwner: true } : {})
    };
  });
}

export function verifyGrantMutationResponse(result: unknown, expectedCount: number): number {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('XGR grant mutation returned no confirmed result. Check state before retrying.');
  const count = (result as { upserted?: unknown }).upserted;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count !== expectedCount)
    throw new Error('XGR grant mutation returned unexpected count. Check state before retrying.');
  return count;
}

export function assertGrantWriteEnabled(readOnly: boolean): void {
  if (readOnly) throw new Error('XGR MCP is in read-only mode; grant writes are disabled.');
}

export function registerGrantTools(server: McpServer, readOnly = env.readOnly): void {
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

  // A read-only gateway must not advertise or execute mutating grant tools.
  if (!readOnly) server.registerTool(
    'manage_xgr_grants',
    {
      title: 'Manage XGR encrypted grants',
      description: 'Create, change or revoke XGR v2 grants through xgr_manageGrants. Requires a short-lived caller-signed xdalaPermit and pre-wrapped 141-byte EncDEK envelopes; RPC enforces grant owner authorization. NEVER send plaintext DEK, P-256 private key, mnemonic, or secrets.',
      // This tool changes the XGR grants database. Never blindly retry it.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        rid,
        scope: z.union([z.literal(1), z.literal(2)]),
        permit,
        entries: z.array(z.object({
          grantee: address,
          rights: z.number().int().min(0).max(7),
          expireAt: z.number().int().nonnegative(),
          encDEK: z.string().regex(ENCRYPTED_DEK),
          isOwner: z.boolean().optional()
        }).strict()).min(1).max(20),
        refAddr: address.optional(),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
        sessionId: z.string().min(1).max(128).optional()
      }
    },
    async ({ rid: targetRid, scope, permit: signedPermit, entries, refAddr, txHash, sessionId }) => {
      // Enforce again at execution, before ANY RPC request or validation side effect.
      assertGrantWriteEnabled(readOnly);
      const now = await assertAuthorizedPermit(signedPermit);
      const owner = signedPermit.message.from.toLowerCase();
      const writeEntries = validateGrantWriteEntries(entries, owner, now);
      // Request ownership is derived from the permit, never client-supplied.
      // XGR RPC MUST verify this signature and enforce owner authority.
      const request = {
        rid: targetRid,
        scope,
        owner,
        entries: writeEntries,
        permit: signedPermit,
        ...(scope === 1 && refAddr ? { refAddr } : {}),
        ...(scope === 2 && txHash ? { txHash } : {}),
        ...(scope === 2 && sessionId ? { sessionId } : {})
      };
      const response: unknown = await rpcCall('xgr_manageGrants', [request]);
      const upserted = verifyGrantMutationResponse(response, writeEntries.length);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            rid: targetRid, scope, owner,
            recipients: writeEntries.map(({ grantee }) => grantee),
            upserted
          })
        }]
      };
    }
  );

}
