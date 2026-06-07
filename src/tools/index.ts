import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerChainTools } from './chainTools.js';
import { registerDiagramTools } from './diagramTools.js';
import { registerKnowledgeTools } from './knowledgeTools.js';
import { registerOperationTools } from './operationTools.js';
import { registerReceiptTools } from './receiptTools.js';
import { registerSessionTools } from './sessionTools.js';
import { registerSessionResolverTools } from './sessionResolverTools.js';
import { registerTransactionTools } from './transactionTools.js';
import { registerXgrTools } from './xgrTools.js';
import { registerXrcTools } from './xrcTools.js';
import { writeToolUsage } from '../shared/usageLog.js';

function instrumentRegisterTool(server: McpServer): void {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (...args: unknown[]) => {
    const name = typeof args[0] === 'string' ? args[0] : 'unknown';
    const handler = args[args.length - 1];
    if (typeof handler === 'function') {
      const wrapped = async (...handlerArgs: unknown[]) => {
        const start = Date.now();
        try {
          const out = await (handler as (...a: unknown[]) => unknown)(...handlerArgs);
          void writeToolUsage({ at: new Date().toISOString(), kind: 'tool_call', tool: name, ok: true, durationMs: Date.now() - start });
          return out;
        } catch (error) {
          void writeToolUsage({ at: new Date().toISOString(), kind: 'tool_call', tool: name, ok: false, durationMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      };
      args[args.length - 1] = wrapped;
    }
    return original(...args);
  };
}

export function registerTools(server: McpServer): void {
  instrumentRegisterTool(server);
  registerChainTools(server);
  registerTransactionTools(server);
  registerSessionTools(server);
  registerSessionResolverTools(server);
  registerReceiptTools(server);
  registerXgrTools(server);
  registerXrcTools(server);
  registerOperationTools(server);
  registerDiagramTools(server);
  registerKnowledgeTools(server);
}
