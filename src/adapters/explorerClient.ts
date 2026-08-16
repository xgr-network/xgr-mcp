import { env } from '../config/env.js';
import { getJson, postJson } from '../shared/http.js';

function apiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${env.explorerApiUrl}${cleanPath}`;
}

function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
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
  },

  getAddressRelationGraph(address: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<unknown> {
    return getJson(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/graph${queryString(params)}`));
  },

  getRelationGraphNeighbors(address: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<unknown> {
    return getJson(apiUrl(`/v2/addresses/${encodeURIComponent(address)}/graph/neighbors${queryString(params)}`));
  },

  getRelationEdgeTransactions(params: Record<string, string | number | boolean | null | undefined>): Promise<unknown> {
    return getJson(apiUrl(`/v2/graph/edge-transactions${queryString(params)}`));
  },

  getNativeXgrValueFlow(txHash: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<unknown> {
    return getJson(apiUrl(`/v2/value-flow/transactions/${encodeURIComponent(txHash)}${queryString(params)}`));
  },

  searchXgrAnalysisTransactions(params: Record<string, string | number | boolean | null | undefined> = {}): Promise<unknown> {
    return getJson(apiUrl(`/v2/analysis/transactions${queryString(params)}`));
  }
};