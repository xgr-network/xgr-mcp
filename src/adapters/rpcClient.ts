import { env } from '../config/env.js';
import { postJson } from '../shared/http.js';

type RpcResponse<T> = {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

let nextId = 1;

export async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await postJson<RpcResponse<T>>(env.rpcUrl, {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.result as T;
}
