import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { env } from './config/env.js';
import { getOperatorSignerConfig } from './shared/operatorSignerConfig.js';
import { getStarterGasConfig } from './shared/starterGasConfig.js';
import { registerTools } from './tools/index.js';
import { registerOperatorSignerTools } from './tools/operatorSignerTools.js';
import { registerStarterGasTools } from './tools/starterGasTools.js';

type DiscoveryHandlerRegistrar = {
  setResourceRequestHandlers: () => void;
  setPromptRequestHandlers: () => void;
};

function registerDiscoveryHandlers(server: McpServer): void {
  const discoveryServer = server as unknown as DiscoveryHandlerRegistrar;
  discoveryServer.setResourceRequestHandlers();
  discoveryServer.setPromptRequestHandlers();
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: env.serverName,
    version: '0.1.0'
  });

  registerTools(server);
  const starterGasConfig = getStarterGasConfig();
  if (starterGasConfig.enabled) registerStarterGasTools(server, starterGasConfig);
  const operatorSignerConfig = getOperatorSignerConfig();
  if (operatorSignerConfig.enabled) registerOperatorSignerTools(server, operatorSignerConfig);
  registerDiscoveryHandlers(server);
  return server;
}
