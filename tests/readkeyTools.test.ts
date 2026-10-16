import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import test from 'node:test';
import { normalizeRegisteredReadkey } from '../src/tools/readkeyTools.js';

const ec = createECDH('prime256v1');
ec.setPrivateKey(Buffer.from('07'.padStart(64, '0'), 'hex'));
const raw = '0x' + ec.getPublicKey(undefined, 'uncompressed').toString('hex');
const compressed = '0x' + ec.getPublicKey(undefined, 'compressed').toString('hex');

test('normalizes only valid on-chain P-256 public points', () => {
  assert.equal(normalizeRegisteredReadkey(raw), raw);
  assert.equal(normalizeRegisteredReadkey(compressed), raw);
});
test('rejects absent, malformed or off-curve keys without inventing a recipient', () => {
  for (const key of [null, '0x', '0x1234', '0x04' + '00'.repeat(64), '0x02' + 'ff'.repeat(32)])
    assert.throws(() => normalizeRegisteredReadkey(key));
});
