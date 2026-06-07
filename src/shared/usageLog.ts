import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../config/env.js';

export type ToolUsageEvent = {
  at: string;
  kind: 'tool_call';
  tool: string;
  ok: boolean;
  durationMs: number;
  userAgent?: string;
  error?: string;
};

export async function writeToolUsage(event: ToolUsageEvent): Promise<void> {
  if (!env.usage.enabled) return;
  const logPath = env.usage.logPath;
  try {
    const dir = dirname(logPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (error) {
    console.warn('tool usage log write failed', error instanceof Error ? error.message : String(error));
  }
}
