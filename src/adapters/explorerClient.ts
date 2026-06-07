import { env } from '../config/env.js';
import { getJson, postJson } from '../shared/http.js';

function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${env.explorerApiUrl}${cleanPath}`;
}

export const explorerClient = {
  getTransaction(hash: string): Promise<unknown> {
    return getJson(apiUrl(`/transaction/${hash}`));
  },

  getTransactionReceipt(hash: string): Promise<unknown> {
    return getJson(apiUrl(`/transaction/${hash}/receipt`));
  },

  getSessionTransactions(sessionId: string, owner: string, page = 1, limit = 50): Promise<unknown> {
    const query = new URLSearchParams({ from: owner, page: String(page), limit: String(limit) });
    return getJson(apiUrl(`/sid/${sessionId}/transactions?${query.toString()}`));
  },

  getSessionReceiptLogs(body: unknown): Promise<unknown> {
    return postJson(apiUrl('/secure/receipts/bulk'), body);
  },

  getSessionsOverview(window: string): Promise<unknown> {
    return getJson(apiUrl(`/sessions/overview?window=${encodeURIComponent(window)}`));
  }
};
