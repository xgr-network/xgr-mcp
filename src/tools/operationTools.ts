import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cancelOperation, createOperation, getOperation, listOperations } from '../operations/store.js';
import { cancelBundleDeployHandoff, createBundleDeployHandoff, getBundleDeployHandoff } from '../operations/bundleDeployStore.js';
import { cancelSessionStartHandoff, createSessionStartHandoff, getSessionStartHandoff } from '../operations/sessionStartStore.js';

function toolJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
}

const SESSION_START_OPERATION_WARNING = 'WARNING: This looks like an XDaLa session-start request. Use create_xdala_session_start_handoff instead of create_operation_handoff.';
const SESSION_START_HINTS = [
  'xgr_validateDataTransfer',
  'SessionPermit',
  'xdala_session_start',
  'xgr-session-start@1',
  'Manage Sessions',
  'start session',
  'ostcId',
  'stepId',
  'payload',
  'XRC-729'
];

function includesSessionStartHint(value: unknown): boolean {
  const haystack = toolJson(value).toLowerCase();
  return SESSION_START_HINTS.some((hint) => haystack.includes(hint.toLowerCase()));
}

const stepSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  txRequest: z.record(z.string(), z.unknown()).optional()
});

export function registerOperationTools(server: McpServer): void {
  server.registerTool(
    'create_operation_handoff',
    {
      title: 'Create operation handoff',
      description: 'Create an offchain human-in-the-loop operation and return a browser URL. The MCP never signs or submits transactions; the user executes locally with a browser wallet on the operation page. Do not use this tool to start, run, launch, execute, or queue XDaLa sessions. Do not use this tool for xgr_validateDataTransfer, SessionPermit, Manage Sessions imports, xgr-session-start@1, XDaLa session start handoffs, or starting a deployed XRC-729 workflow. For these intents, use create_xdala_session_start_handoff. If create_xdala_session_start_handoff is unavailable, report that the session-start tool is unavailable instead of falling back to create_operation_handoff.',
      inputSchema: {
        type: z.string().min(1),
        network: z.string().min(1),
        chainId: z.number().int().positive(),
        summary: z.record(z.string(), z.unknown()).optional(),
        payload: z.unknown().optional(),
        validation: z.unknown().optional(),
        policy: z.record(z.string(), z.unknown()).optional(),
        steps: z.array(stepSchema).optional(),
        ttlSeconds: z.number().int().positive().optional()
      }
    },
    async (input) => {
      const result = await createOperation(input);
      const operation = includesSessionStartHint({
        summary: input.summary,
        title: input.summary,
        policy: input.policy,
        steps: input.steps,
        txRequest: input.steps?.map((step) => step.txRequest)
      }) ? { ...result.operation, warning: SESSION_START_OPERATION_WARNING } : result.operation;
      return { content: [{ type: 'text', text: toolJson(operation) }] };
    }
  );

  server.registerTool(
    'get_operation_status',
    {
      title: 'Get operation status',
      description: 'Return the current status of an operation handoff. Use this after the user opens the operation page and signs or cancels local wallet transactions.',
      inputSchema: {
        operationId: z.string().min(1),
        secret: z.string().optional()
      }
    },
    async ({ operationId, secret }) => {
      const operation = await getOperation(operationId, secret);
      if (!operation) {
        return { content: [{ type: 'text', text: toolJson({ error: 'operation not found or token mismatch' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: toolJson(operation) }] };
    }
  );

  server.registerTool(
    'cancel_operation_handoff',
    {
      title: 'Cancel operation handoff',
      description: 'Cancel a pending offchain operation handoff. This never cancels already signed or submitted chain transactions.',
      inputSchema: {
        operationId: z.string().min(1),
        secret: z.string().min(1)
      }
    },
    async ({ operationId, secret }) => {
      const operation = await cancelOperation(operationId, secret);
      if (!operation) {
        return { content: [{ type: 'text', text: toolJson({ error: 'operation not found or token mismatch' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: toolJson(operation) }] };
    }
  );

  server.registerTool(
    'create_xdala_bundle_deploy_handoff',
    {
      title: 'Create XDaLa bundle deploy handoff',
      description: 'Store a validated xgr-multi-bundle@1 bundle offchain under an unguessable bearer handle and return an XDaLa Workbench import URL. The MCP does not sign, submit, or execute transactions.',
      inputSchema: {
        network: z.string().min(1),
        chainId: z.number().int().positive(),
        bundle: z.record(z.string(), z.unknown()),
        summary: z.record(z.string(), z.unknown()).optional(),
        validation: z.record(z.string(), z.unknown()).optional(),
        ttlSeconds: z.number().int().positive().optional()
      }
    },
    async (input) => {
      try {
        const result = await createBundleDeployHandoff(input);
        return { content: [{ type: 'text', text: toolJson(result) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: toolJson({ error: error instanceof Error ? error.message : String(error) }) }], isError: true };
      }
    }
  );

  server.registerTool(
    'get_xdala_bundle_deploy_handoff',
    {
      title: 'Get XDaLa bundle deploy handoff',
      description: 'Return stored metadata, bundle JSON, and any recorded deployed result/artifact for an XDaLa bundle deploy handoff handle.',
      inputSchema: {
        handle: z.string().min(1)
      }
    },
    async ({ handle }) => {
      const handoff = await getBundleDeployHandoff(handle);
      if (!handoff) {
        return { content: [{ type: 'text', text: toolJson({ error: 'bundle deploy handoff not found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: toolJson(handoff) }] };
    }
  );

  server.registerTool(
    'get_xdala_bundle_deploy_result',
    {
      title: 'Get XDaLa bundle deploy result',
      description: 'Return the stored XDaLa bundle deploy result, canonical deployed artifact, and audit events for a handoff handle. This is read-only and never signs, submits, or executes transactions.',
      inputSchema: {
        handle: z.string().min(1)
      }
    },
    async ({ handle }) => {
      const handoff = await getBundleDeployHandoff(handle);
      if (!handoff) {
        return { content: [{ type: 'text', text: toolJson({ error: 'bundle deploy handoff not found' }) }], isError: true };
      }
      return {
        content: [{
          type: 'text',
          text: toolJson({
            handle: handoff.handle,
            status: handoff.status,
            result: handoff.result,
            deployedArtifact: handoff.deployedArtifact,
            events: handoff.events
          })
        }]
      };
    }
  );

  server.registerTool(
    'cancel_xdala_bundle_deploy_handoff',
    {
      title: 'Cancel XDaLa bundle deploy handoff',
      description: 'Cancel a pending XDaLa bundle deploy handoff. This is offchain metadata only and never cancels chain transactions.',
      inputSchema: {
        handle: z.string().min(1)
      }
    },
    async ({ handle }) => {
      const handoff = await cancelBundleDeployHandoff(handle);
      if (!handoff) {
        return { content: [{ type: 'text', text: toolJson({ error: 'bundle deploy handoff not found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: toolJson(handoff) }] };
    }
  );


  const sessionSourceSchema = z.enum(['runtime', 'bundle_deploy_result', 'direct']);
  const sessionHintSchema = z.object({
    __uid: z.string().optional(),
    stepId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    maxTotalGas: z.number().int().nonnegative().optional(),
    expiry: z.number().int().positive().optional(),
    starterAddress: z.string().optional()
  });

  server.registerTool(
    'create_xdala_session_start_handoff',
    {
      title: 'Create XDaLa session start handoff',
      description: 'Prepare and store a read-only xgr-session-start@1 handoff for xDaLa Workbench. Use this tool whenever the user wants to start, run, launch, execute, queue, or prepare an XDaLa session. Use this tool for starting an existing deployed XRC-729/XRC-137 workflow, starting from a runtime XRC-729 orchestration, starting from a bundle deploy result, or importing a canonical xgr-session-start@1 request into xDaLa Manage Sessions. When explaining required input to users, use canonical xgr-session-start@1 terminology: sessions[].orchestration, sessions[].ostcId, sessions[].stepId, sessions[].payload, sessions[].maxTotalGas. Do not ask users for entryStepId; entryStepId is not the Workbench Session Start field. For deployed XRC-729 workflows, first inspect the runtime, identify ostcId and the likely entry step, resolve that step\'s XRC-137 rule, derive required payload fields from the XRC-137 payload schema, treat fields with defaults as optional, and present required and optional/default fields before creating a handoff. Do not call this tool with guessed payload values. If required start payload fields are missing, first present the required fields to the user and ask for values or explicit permission to use demo values. Only use demo/dummy/example/default values when the user explicitly asks or accepts them. This tool returns a Workbench xdalaUrl such as https://xdala.devnet.xgr.network/session-start/ss_... . The agent must show the returned xdalaUrl to the user. Do not replace the xdalaUrl with a generic /operations/op_... link. The MCP does not sign, submit, or execute. xDaLa Workbench performs local signing and calls xgr_validateDataTransfer. Do not describe the XRC-729 contract owner as the owner of a not-yet-started session; owner()/getOwner() and getExecutorList() identify start-authority roles only. Use sessions[].starterAddress only as an intended starter when explicitly set, and use terminal result data such as result.results[].owner/sessionId/pid for the actual session owner/starter after Workbench start.',
      inputSchema: {
        source: sessionSourceSchema,
        network: z.string().min(1),
        chainId: z.number().int().positive().optional(),
        orchestration: z.string().optional(),
        ostcId: z.string().optional(),
        ostcHash: z.string().optional(),
        bundleDeployHandle: z.string().optional(),
        request: z.record(z.string(), z.unknown()).optional(),
        sessions: z.array(sessionHintSchema).optional(),
        stepId: z.string().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
        maxTotalGas: z.number().int().nonnegative().optional(),
        expiry: z.number().int().positive().optional(),
        signing: z.record(z.string(), z.unknown()).optional(),
        executorGrants: z.record(z.string(), z.unknown()).optional(),
        execution: z.record(z.string(), z.unknown()).optional(),
        ui: z.record(z.string(), z.unknown()).optional(),
        security: z.record(z.string(), z.unknown()).optional(),
        expectedSigner: z.string().optional(),
        walletAddress: z.string().optional(),
        summary: z.record(z.string(), z.unknown()).optional(),
        ttlSeconds: z.number().int().positive().optional()
      }
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: toolJson(await createSessionStartHandoff(input)) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: toolJson({ error: error instanceof Error ? error.message : String(error) }) }], isError: true };
      }
    }
  );

  server.registerTool(
    'get_xdala_session_start_handoff',
    {
      title: 'Get XDaLa session start handoff',
      description: 'Read stored xDaLa session start handoff metadata, canonical request, authority, derived sessionOwnership role summary, validation, lean result summary, and terminal result. Read-only; does not sign, submit, or execute. Use sessionOwnership to avoid confusing the XRC-729 contract owner with the actual session owner/starter before Workbench completion.',
      inputSchema: { handle: z.string().min(1) }
    },
    async ({ handle }) => {
      const handoff = await getSessionStartHandoff(handle);
      if (!handoff) return { content: [{ type: 'text', text: toolJson({ error: 'session start handoff not found' }) }], isError: true };
      return { content: [{ type: 'text', text: toolJson(handoff) }] };
    }
  );

  server.registerTool(
    'cancel_xdala_session_start_handoff',
    {
      title: 'Cancel XDaLa session start handoff',
      description: 'Cancel pending xDaLa session start handoff metadata only. This preparation/read-only MCP tool does not sign, submit, execute, or cancel on-chain work.',
      inputSchema: { handle: z.string().min(1) }
    },
    async ({ handle }) => {
      const handoff = await cancelSessionStartHandoff(handle);
      if (!handoff) return { content: [{ type: 'text', text: toolJson({ error: 'session start handoff not found' }) }], isError: true };
      return { content: [{ type: 'text', text: toolJson(handoff) }] };
    }
  );

  server.registerTool(
    'get_xdala_session_start_result',
    {
      title: 'Get XDaLa session start result',
      description: 'Return terminal xDaLa session start result, lean result summary, and audit events. Read-only preparation/result lookup only; the MCP does not sign, submit, or execute, and users sign locally in Workbench/wallet/local signer. For completed handoffs, prefer result.results[].owner/sessionId/pid over XRC-729 contract owner facts when identifying the actual session owner/starter.',
      inputSchema: { handle: z.string().min(1) }
    },
    async ({ handle }) => {
      const handoff = await getSessionStartHandoff(handle);
      if (!handoff) return { content: [{ type: 'text', text: toolJson({ error: 'session start handoff not found' }) }], isError: true };
      return { content: [{ type: 'text', text: toolJson({ handle: handoff.handle, status: handoff.status, sessionOwnership: handoff.sessionOwnership, resultSummary: handoff.resultSummary, result: handoff.result, events: handoff.events }) }] };
    }
  );

  server.registerTool(
    'list_recent_operations',
    {
      title: 'List recent operations',
      description: 'List recent offchain operation handoffs. Secrets and browser execution tokens are never returned by this tool.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional()
      }
    },
    async ({ limit = 20 }) => ({
      content: [{ type: 'text', text: toolJson(await listOperations(limit)) }]
    })
  );
}
