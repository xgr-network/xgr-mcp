import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { env } from './config/env.js';
import { registerTools } from './tools/index.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: env.serverName,
    version: '0.1.0'
  });

  registerTools(server);
  return server;
}
