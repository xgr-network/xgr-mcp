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

export function registerTools(server: McpServer): void {
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
