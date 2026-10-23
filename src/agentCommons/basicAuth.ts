import { createHash, timingSafeEqual } from 'node:crypto';

/** A second check of credentials already validated by Nginx Basic Auth.
 * Never trust a proxy flag or unverified forwarded identity headers.
 */
export function verifyNginxBasicAuth(
  authorization: string | undefined,
  expectedSha256: string,
  expectedUsername: string
): boolean {
  if (!authorization || authorization.length > 1500 ||
      !/^[a-f0-9]{64}$/i.test(expectedSha256) || !expectedUsername) return false;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorization);
  if (!match) return false;
  const data = Buffer.from(match[1], 'base64');
  if (!data.length || data.length > 512) return false;
  const decoded = data.toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 1 || decoded.slice(0, colon) !== expectedUsername) return false;
  const expected = Buffer.from(expectedSha256, 'hex');
  const actual = createHash('sha256').update(decoded.slice(colon + 1)).digest();
  return timingSafeEqual(actual, expected);
}
