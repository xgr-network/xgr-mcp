import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { verifyNginxBasicAuth } from '../src/agentCommons/basicAuth.js';

test('Nginx Basic Auth validates the configured user and password', () => {
  const secret = 'strong-example-secret-not-for-production';
  const digest = createHash('sha256').update(secret).digest('hex');
  const auth = (username: string, password: string) =>
    'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  assert.equal(verifyNginxBasicAuth(auth('xgradmin', secret), digest, 'xgradmin'), true);
  assert.equal(verifyNginxBasicAuth(auth('xgradmin', 'wrong'), digest, 'xgradmin'), false);
  assert.equal(verifyNginxBasicAuth(auth('other', secret), digest, 'xgradmin'), false);
  assert.equal(verifyNginxBasicAuth('Bearer abcdef', digest, 'xgradmin'), false);
  assert.equal(verifyNginxBasicAuth(undefined, digest, 'xgradmin'), false);
  assert.equal(verifyNginxBasicAuth(auth('xgradmin', secret), 'invalid', 'xgradmin'), false);
  assert.equal(verifyNginxBasicAuth(auth('xgradmin', secret), digest, ''), false);
});
