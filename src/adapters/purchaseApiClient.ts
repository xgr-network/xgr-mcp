import type { PurchaseConfig } from '../shared/purchaseConfig.js';

const TIMEOUT_MS = 10_000;
export class PurchaseApiError extends Error {
  constructor(public readonly endpoint: string, public readonly status: number, public readonly response: string) {
    super(`Purchase API request failed for ${endpoint} (HTTP ${status}): ${response}`);
  }
}
export class PurchaseApiResponseError extends Error {
  readonly postCompleted = true;
  constructor(public readonly endpoint: string, public readonly status: number, public readonly rawResponse: string) {
    super('Purchase API returned invalid JSON after completing the order request.');
  }
}
export class PurchaseApiClient {
  constructor(private readonly baseUrl: string) {}
  private async request(path: string, init: RequestInit = {}, orderPost = false): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(new URL(path, `${this.baseUrl}/`).toString(), { ...init, redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...init.headers } });
      const body = await response.text();
      if (!response.ok) throw new PurchaseApiError(path, response.status, body.slice(0, 500));
      try { return body ? JSON.parse(body) : {}; } catch {
        if (orderPost) throw new PurchaseApiResponseError(path, response.status, body);
        throw new PurchaseApiError(path, response.status, 'Invalid JSON response');
      }
    } catch (error) {
      if (error instanceof PurchaseApiError || error instanceof PurchaseApiResponseError) throw error;
      throw new PurchaseApiError(path, 0, (error instanceof Error ? error.message : 'Request failed').slice(0, 500));
    } finally { clearTimeout(timeout); }
  }
  paymentAssets() { return this.request('/api/payment-assets'); }
  price() { return this.request('/api/xgr-price'); }
  availability() { return this.request('/api/xgr-availability'); }
  createOrder(payload: Record<string, unknown>) { return this.request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, true); }
}
export function purchaseApiClient(config: PurchaseConfig): PurchaseApiClient { if (!config.enabled || !config.apiBaseUrl) throw new Error('XGR purchase tools are not enabled.'); return new PurchaseApiClient(config.apiBaseUrl); }
