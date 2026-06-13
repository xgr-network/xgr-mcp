import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { env } from './config/env.js';
import { registerTools } from './tools/index.js';

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
  registerDiscoveryHandlers(server);
  return server;
}
