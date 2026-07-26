import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';

type McpRequestContext = {
  clientIp?: string;
};

type RequestHeaders = Record<string, string | string[] | undefined>;

const storage = new AsyncLocalStorage<McpRequestContext>();

function normalizeIp(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const unwrapped = raw.startsWith('[') && raw.includes(']') ? raw.slice(1, raw.indexOf(']')) : raw;
  const mapped = unwrapped.startsWith('::ffff:') ? unwrapped.slice(7) : unwrapped;
  return isIP(mapped) ? mapped : undefined;
}

function isLoopback(value: string | undefined): boolean {
  const ip = normalizeIp(value);
  return ip === '::1' || Boolean(ip && ip.startsWith('127.'));
}

export function resolveTrustedClientIp(headers: RequestHeaders, remoteAddress: string | undefined): string {
  const remoteIp = normalizeIp(remoteAddress) ?? 'unknown';
  if (!isLoopback(remoteAddress)) return remoteIp;

  const forwarded = headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwarded = normalizeIp(forwardedValue?.split(',')[0]);
  if (firstForwarded) return firstForwarded;

  const realIp = headers['x-real-ip'];
  const realIpValue = Array.isArray(realIp) ? realIp[0] : realIp;
  return normalizeIp(realIpValue) ?? remoteIp;
}

export function runWithMcpRequestContext<T>(context: McpRequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getMcpRequestContext(): McpRequestContext {
  return storage.getStore() ?? {};
}
