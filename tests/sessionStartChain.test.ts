import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import express from 'express';

const RPC_CHAIN_ID_HEX = '0x757';
const RPC_CHAIN_ID_DEC = 1879;
const ORCHESTRATION = '0x1111111111111111111111111111111111111111';

let rpcUrl = '';
let storeDir = '';
let server: ReturnType<typeof createServer>;
let createSessionStartHandoff: typeof import('../src/operations/sessionStartStore.js').createSessionStartHandoff;
let recordSessionStartResult: typeof import('../src/operations/sessionStartStore.js').recordSessionStartResult;
let getSessionStartHandoff: typeof import('../src/operations/sessionStartStore.js').getSessionStartHandoff;
let registerOperationRoutes: typeof import('../src/operations/routes.js').registerOperationRoutes;
let publicHandoffErrorHandler: typeof import('../src/operations/publicHandoffSecurity.js').publicHandoffErrorHandler;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function writeRpc(res: ServerResponse, id: unknown, result: string): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

function makeRequest(chain?: Record<string, unknown>, starterAddress?: string) {
  return {
    type: 'xdala_session_start',
    version: 'xgr-session-start@1',
    mode: 'single',
    sessions: [{
      orchestration: ORCHESTRATION,
      ostcId: 'ostc-test',
      stepId: 'start',
      payload: {},
      maxTotalGas: 0,
      ...(starterAddress ? { starterAddress } : {})
    }],
    ...(chain ? { chain } : {})
  };
}

before(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'xgr-session-start-chain-'));
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (body.method === 'eth_chainId') return writeRpc(res, body.id, RPC_CHAIN_ID_HEX);
    if (body.method === 'eth_call') return writeRpc(res, body.id, '0x');
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'not mocked' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  rpcUrl = `http://127.0.0.1:${address.port}`;
  process.env.XGR_RPC_URL = rpcUrl;
  process.env.MCP_SESSION_START_STORE_DIR = storeDir;
  process.env.MCP_OPERATION_STORE_DIR = join(storeDir, 'operations');
  ({ createSessionStartHandoff, recordSessionStartResult, getSessionStartHandoff } = await import('../src/operations/sessionStartStore.js'));
  ({ registerOperationRoutes } = await import('../src/operations/routes.js'));
  ({ publicHandoffErrorHandler } = await import('../src/operations/publicHandoffSecurity.js'));
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(storeDir, { recursive: true, force: true });
});

test('create_xdala_session_start_handoff stores RPC-derived chain expectations without input chainId', async () => {
  const handoff = await createSessionStartHandoff({
    source: 'direct',
    network: 'devnet',
    request: makeRequest()
  });

  assert.equal(handoff.chainId, RPC_CHAIN_ID_DEC);
  assert.equal(handoff.request.chain?.requiredChainIdHex, RPC_CHAIN_ID_HEX);
  assert.equal(handoff.request.chain?.requiredChainIdDec, String(RPC_CHAIN_ID_DEC));
  assert.equal(handoff.request.chain?.rpcPolicy, 'useOpsConnectedRpc');
});

test('create_xdala_session_start_handoff rejects caller-provided wrong expected chainId', async () => {
  await assert.rejects(
    createSessionStartHandoff({
      source: 'direct',
      network: 'devnet',
      chainId: 1,
      request: makeRequest()
    }),
    /chainId mismatch: input expected 1, RPC returned 1879/
  );
});

test('create_xdala_session_start_handoff overwrites stale direct request chain values from RPC', async () => {
  const handoff = await createSessionStartHandoff({
    source: 'direct',
    network: 'devnet',
    request: makeRequest({
      network: 'devnet',
      requiredChainIdHex: '0x1',
      requiredChainIdDec: '1',
      rpcPolicy: 'callerProvided'
    })
  });

  assert.equal(handoff.chainId, RPC_CHAIN_ID_DEC);
  assert.equal(handoff.request.chain?.network, 'devnet');
  assert.equal(handoff.request.chain?.requiredChainIdHex, RPC_CHAIN_ID_HEX);
  assert.equal(handoff.request.chain?.requiredChainIdDec, String(RPC_CHAIN_ID_DEC));
  assert.equal(handoff.request.chain?.rpcPolicy, 'useOpsConnectedRpc');
});


test('sessionOwnership keeps XRC-729 owner distinct before Workbench start', async () => {
  const handoff = await createSessionStartHandoff({
    source: 'direct',
    network: 'devnet',
    request: makeRequest(undefined, '0x2222222222222222222222222222222222222222')
  });

  assert.equal(handoff.sessionOwnership.status, 'not_final');
  assert.deepEqual(handoff.sessionOwnership.intendedStarterAddresses, ['0x2222222222222222222222222222222222222222']);
  assert.match(handoff.sessionOwnership.note, /actual session owner\/starter is not final/);
  assert.equal(handoff.sessionOwnership.actualSessionOwners, undefined);
});

test('sessionOwnership uses terminal result owner after Workbench start', async () => {
  const handoff = await createSessionStartHandoff({
    source: 'direct',
    network: 'devnet',
    request: makeRequest()
  });

  const updated = await recordSessionStartResult(handoff.handle, {
    handle: handoff.handle,
    type: 'xdala_session_start_result',
    status: 'completed',
    completedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    inputType: 'workbench',
    results: [{ ok: true, sessionId: 'session-1', owner: '0x3333333333333333333333333333333333333333' }]
  });

  assert(updated && !('error' in updated));
  assert.equal(updated.sessionOwnership.status, 'actual_recorded');
  assert.deepEqual(updated.sessionOwnership.actualSessionOwners, ['0x3333333333333333333333333333333333333333']);
  assert.match(updated.sessionOwnership.note, /terminal Workbench result data/);
});


test('session-start records expose not_available resultSummary before terminal result', async () => {
  const handoff = await createSessionStartHandoff({
    source: 'direct',
    network: 'devnet',
    request: makeRequest()
  });

  assert.deepEqual(handoff.resultSummary, {
    status: 'not_available',
    total: 0,
    ok: 0,
    failed: 0,
    owners: [],
    sessionIds: [],
    pids: [],
    orchestrations: [],
    ostcIds: [],
    stepIds: [],
    evidenceReady: false
  });
});

test('session-start resultSummary reflects terminal completed, partial, failed, and cancelled results', async () => {
  for (const status of ['completed', 'partial', 'failed', 'cancelled'] as const) {
    const handoff = await createSessionStartHandoff({
      source: 'direct',
      network: 'devnet',
      request: makeRequest()
    });
    const hasOk = status === 'completed' || status === 'partial';
    const results = hasOk
      ? [
          {
            ok: true,
            sessionId: `session-${status}`,
            pid: `pid-${status}`,
            owner: '0x3333333333333333333333333333333333333333',
            orchestration: ORCHESTRATION,
            ostcId: 'ostc-test',
            stepId: 'start'
          },
          ...(status === 'partial' ? [{ ok: false, error: 'manual failure', ostcId: 'ostc-test', stepId: 'start' }] : [])
        ]
      : status === 'failed'
        ? [{ ok: false, error: 'manual failure', ostcId: 'ostc-test', stepId: 'start' }]
        : [];

    const updated = await recordSessionStartResult(handoff.handle, {
      handle: handoff.handle,
      type: 'xdala_session_start_result',
      status,
      completedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      inputType: 'workbench',
      results
    });

    assert(updated && !('error' in updated));
    assert.equal(updated.resultSummary.status, status);
    assert.equal(updated.resultSummary.total, results.length);
    assert.equal(updated.resultSummary.ok, results.filter((result) => result.ok === true).length);
    assert.equal(updated.resultSummary.failed, results.filter((result) => result.ok === false).length);
    assert.equal(updated.resultSummary.evidenceReady, hasOk);
    if (hasOk) {
      assert.deepEqual(updated.resultSummary.sessionIds, [`session-${status}`]);
      assert.deepEqual(updated.resultSummary.pids, [`pid-${status}`]);
      assert.deepEqual(updated.resultSummary.owners, ['0x3333333333333333333333333333333333333333']);
      assert.deepEqual(updated.resultSummary.orchestrations, [ORCHESTRATION]);
    }
  }
});

test('public session-start routes omit status callback and accept terminal result callback', async () => {
  const app = express();
  registerOperationRoutes(app);
  app.use(publicHandoffErrorHandler);

  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const handoff = await createSessionStartHandoff({
      source: 'direct',
      network: 'devnet',
      request: makeRequest()
    });

    const getResponse = await fetch(`${baseUrl}/api/session-start/${handoff.handle}`, { headers: { accept: 'application/json' } });
    assert.equal(getResponse.status, 200);
    const getBody = await getResponse.json() as Record<string, unknown>;
    assert.equal(getBody.handle, handoff.handle);
    assert.deepEqual((getBody.resultSummary as Record<string, unknown>).status, 'not_available');

    const statusResponse = await fetch(`${baseUrl}/api/session-start/${handoff.handle}/status`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ handle: handoff.handle, type: 'xdala_session_start_status', status: 'imported', updatedAt: new Date().toISOString() })
    });
    assert.equal(statusResponse.status, 404);

    const resultResponse = await fetch(`${baseUrl}/api/session-start/${handoff.handle}/result`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: handoff.handle,
        type: 'xdala_session_start_result',
        status: 'completed',
        completedAt: new Date().toISOString(),
        inputType: 'workbench',
        results: [{ ok: true, sessionId: 'session-route', owner: '0x3333333333333333333333333333333333333333' }]
      })
    });
    assert.equal(resultResponse.status, 200);
    assert.deepEqual(await resultResponse.json(), { ok: true, handle: handoff.handle, status: 'completed' });

    const stored = await getSessionStartHandoff(handoff.handle);
    assert(stored);
    assert.equal(stored.resultSummary.status, 'completed');
    assert.equal(stored.resultSummary.total, 1);
    assert.equal(stored.resultSummary.evidenceReady, true);
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
});
