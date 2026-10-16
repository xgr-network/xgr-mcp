import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGrantItems, validateGrantSummaryItems } from '../src/tools/grantTools.js';

const rid = '0x' + 'ab'.repeat(32);
const grantee = '0x' + '12'.repeat(20);
const now = 1_700_000_000;
const encDEK = '0x04' + '00'.repeat(140);
const valid = { rid, scope: 1, grantee, rights: 1, expiresAt: now + 60, encDEK };

test('requires an exact RID, scope, grantee and READ permission', () => {
  assert.equal(validateGrantItems({ items: [valid] }, rid, 1, grantee, now).length, 1);
  for (const modified of [
    { ...valid, rid: '0x' + 'cd'.repeat(32) },
    { ...valid, scope: 2 },
    { ...valid, grantee: '0x' + '34'.repeat(20) },
    { ...valid, rights: 2 },
    { ...valid, rights: 0 }
  ]) {
    assert.throws(() => validateGrantItems({ items: [modified] }, rid, 1, grantee, now));
  }
});

test('rejects expired, malformed and missing ciphertext grants', () => {
  for (const modified of [
    { ...valid, expiresAt: now },
    { ...valid, expiresAt: -1 },
    { ...valid, expiresAt: 'never' },
    { ...valid, encDEK: '0x1234' },
    { ...valid, encDEK: undefined },
    { ...valid, rights: 1.5 }
  ]) {
    assert.throws(() => validateGrantItems({ items: [modified] }, rid, 1, grantee, now));
  }
  assert.throws(() => validateGrantItems({ items: [null] }, rid, 1, grantee, now));
});

test('permits non-expiring and READ+MANAGE grants, but never returns unexpected metadata', () => {
  const [grant] = validateGrantItems({ items: [{ ...valid, rights: 5, expiresAt: 0, sensitive: 'excluded' }] }, rid, 1, grantee, now);
  assert.equal(grant?.rights, 5);
  assert.equal(grant?.expiresAt, 0);
  assert.equal(Object.hasOwn(grant ?? {}, 'sensitive'), false);
});

test('Manage Grants list accepts legitimate recipient metadata without returning EncDEK', () => {
  const [summary] = validateGrantSummaryItems([
    { ...valid, owner: grantee, isOwner: true, refAddr: '0x' + '34'.repeat(20), txHash: null }
  ], 1, rid);
  assert.equal(summary?.rights, 1);
  assert.equal(summary?.isOwner, true);
  assert.equal(Object.hasOwn(summary ?? {}, 'encDEK'), false);
});

test('Manage Grants listing includes valid zero-rights and expired rows as metadata', () => {
  const [summary] = validateGrantSummaryItems([
    { ...valid, owner: grantee, rights: 0, expiresAt: now - 100, isOwner: false }
  ], 1);
  assert.equal(summary?.rights, 0);
  assert.equal(summary?.expiresAt, now - 100);
});

test('Manage Grants rejects unexpected scope, invalid rights and malformed metadata', () => {
  const base = { ...valid, owner: grantee };
  for (const modified of [
    { ...base, scope: 2 },
    { ...base, rid: '0x' + 'dd'.repeat(32) },
    { ...base, rights: 8 },
    { ...base, rights: 1.5 },
    { ...base, expiresAt: -1 },
    { ...base, owner: 'invalid' },
    { ...base, grantee: 'invalid' },
    { ...base, refAddr: 'invalid' },
    { ...base, txHash: 'invalid' }
  ]) assert.throws(() => validateGrantSummaryItems([modified], 1, rid));
});
