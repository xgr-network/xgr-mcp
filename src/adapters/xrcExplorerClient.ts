import { env } from '../config/env.js';

const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function apiUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${normalizeBaseUrl(env.explorerApiUrl)}${cleanPath}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function getExplorerJson<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl(path, query), {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });

    if (res.status === 404) return null as T;
    if (!res.ok) throw new Error(`Explorer GET ${path} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export interface XrcContractQuery {
  owner?: string;
  type?: 'xrc137' | 'xrc729';
  page?: number;
  limit?: number;
}

export interface XrcEventQuery {
  owner?: string;
  contract?: string;
  type?: 'xrc137' | 'xrc729';
  action?: 'deploy' | 'update' | 'ostc_update' | 'ostc_delete';
  txHash?: string;
  fromBlock?: number;
  toBlock?: number;
  page?: number;
  limit?: number;
}

export const xrcExplorerClient = {
  listContracts(query: XrcContractQuery): Promise<unknown> {
    return getExplorerJson('/xrc/contracts', { ...query });
  },

  listAddressContracts(address: string, query: Omit<XrcContractQuery, 'owner'>): Promise<unknown> {
    return getExplorerJson(`/address/${encodeURIComponent(address)}/xrc/contracts`, query);
  },

  getContract(address: string): Promise<unknown> {
    return getExplorerJson(`/xrc/contracts/${encodeURIComponent(address)}`);
  },

  listEvents(query: XrcEventQuery): Promise<unknown> {
    return getExplorerJson('/xrc/events', { ...query });
  },

  listAddressEvents(address: string, query: Omit<XrcEventQuery, 'owner'>): Promise<unknown> {
    return getExplorerJson(`/address/${encodeURIComponent(address)}/xrc/events`, query);
  },

  listContractEvents(address: string, query: { page?: number; limit?: number }): Promise<unknown> {
    return getExplorerJson(`/xrc/contracts/${encodeURIComponent(address)}/events`, query);
  },

  listXrc729OstcState(address: string, query: { includeDeleted?: boolean; page?: number; limit?: number }): Promise<unknown> {
    return getExplorerJson(`/xrc729/${encodeURIComponent(address)}/ostc`, query);
  }
};
