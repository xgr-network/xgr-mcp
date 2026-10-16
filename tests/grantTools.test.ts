import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGrantItems } from '../src/tools/grantTools.js';

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
