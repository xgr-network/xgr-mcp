export const XGR_PURCHASE_CHAIN_ID = 1643;
export const XGR_PURCHASE_HARD_MAX_EUR = 249.99;
export const XGR_BILLING_ADDRESS_THRESHOLD_EUR = 250;
export type PurchaseConfig = { enabled: boolean; network?: 'mainnet'; apiBaseUrl?: string; maxEur?: number };
export function getPurchaseConfig(env: NodeJS.ProcessEnv = process.env): PurchaseConfig {
  if (env.XGR_PURCHASE_TOOLS_ENABLED !== 'true' || env.XGR_PURCHASE_NETWORK !== 'mainnet') return { enabled: false };
  const rawUrl = env.XGR_PURCHASE_API_BASE_URL?.trim();
  if (!rawUrl) throw new Error('XGR_PURCHASE_API_BASE_URL is required when purchase tools are enabled.');
  let url: URL; try { url = new URL(rawUrl); } catch { throw new Error('Invalid XGR_PURCHASE_API_BASE_URL.'); }
  const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localHttp) throw new Error('XGR_PURCHASE_API_BASE_URL must use HTTPS outside localhost.');
  const rawMax = env.XGR_PURCHASE_MAX_EUR?.trim(); const maxEur = rawMax ? Number(rawMax) : XGR_PURCHASE_HARD_MAX_EUR;
  if (!Number.isFinite(maxEur) || maxEur <= 0 || maxEur > XGR_PURCHASE_HARD_MAX_EUR) throw new Error('Invalid XGR_PURCHASE_MAX_EUR: expected a positive number no greater than 249.99.');
  return { enabled: true, network: 'mainnet', apiBaseUrl: url.toString().replace(/\/$/, ''), maxEur };
}
