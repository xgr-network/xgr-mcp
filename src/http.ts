import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { env } from './config/env.js';
import { createMcpServer } from './server.js';
import { registerOperationRoutes } from './operations/routes.js';
import { publicHandoffErrorHandler } from './operations/publicHandoffSecurity.js';

const app = express();

app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    name: env.serverName,
    readOnly: env.readOnly
  });
});

registerOperationRoutes(app);
app.use(publicHandoffErrorHandler);

app.post('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed. Use POST /mcp.' });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed. This read-only gateway uses stateless POST requests.' });
});

app.listen(env.httpPort, env.httpHost, () => {
  console.log(`${env.serverName} listening on http://${env.httpHost}:${env.httpPort}/mcp`);
});
