import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getKnowledgeDoc, knowledgeDocTopics, type KnowledgeDocTopic, xdalaAuthoringRules, xgrMultiBundleReference } from '../knowledge/docs.js';
import { validateXDaLaBlueprint, validateXrc137Authoring } from '../knowledge/xdalaValidator.js';
import { validateXDaLaRules } from '../knowledge/xdalaRulesValidator.js';
import { validateSessionStartRequest } from '../operations/sessionStartStore.js';
import { xrc137Examples, xrc137Reference, xrc137Schema } from '../knowledge/xrc137.js';
import { xrc729Examples, xrc729Reference, xrc729Schema } from '../knowledge/xrc729.js';
import { xgrMultiBundleSchema, xgrSessionStartSchema, validateXgrMultiBundle, validateXgrSessionStart } from '../knowledge/multiBundle.js';

const standards = {
  'xrc-137': { reference: xrc137Reference, schema: xrc137Schema, examples: xrc137Examples },
  'xrc-729': { reference: xrc729Reference, schema: xrc729Schema, examples: xrc729Examples },
  'xdala-authoring': { reference: xdalaAuthoringRules, schema: {}, examples: {} },
  'xgr-multibundle': { reference: xgrMultiBundleReference, schema: xgrMultiBundleSchema, examples: {} }
} as const;

const standardNames = ['xrc-137', 'xrc-729', 'xdala-authoring', 'xgr-multibundle'] as const;
type StandardName = keyof typeof standards;

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool('list_xgr_standards', { title: 'List XGR standards', description: 'List agent-readable XGR and XDaLa standards available in the MCP knowledge base.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify(Object.keys(standards), null, 2) }] }));

  server.registerTool('list_xgr_docs', { title: 'List XGR documentation topics', description: 'List canonical Markdown documentation topics served by the MCP knowledge base.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify(knowledgeDocTopics, null, 2) }] }));

  server.registerTool('get_xgr_doc', { title: 'Get XGR documentation topic', description: 'Retrieve canonical Markdown documentation for an XGR/XDaLa topic.', inputSchema: { topic: z.enum(knowledgeDocTopics) } }, async ({ topic }) => ({ content: [{ type: 'text', text: getKnowledgeDoc(topic as KnowledgeDocTopic) }] }));

  server.registerTool('get_xdala_authoring_rules', { title: 'Get XDaLa authoring rules', description: 'Use this before creating, modifying or reviewing XRC/XDaLa artifacts.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: xdalaAuthoringRules }] }));

  server.registerTool('get_xgr_standard_reference', { title: 'Get XGR standard reference', description: 'Use this before drafting XRC-137 or XRC-729 artifacts.', inputSchema: { standard: z.enum(standardNames) } }, async ({ standard }) => ({ content: [{ type: 'text', text: standards[standard as StandardName].reference }] }));

  server.registerTool('get_xgr_standard_schema', { title: 'Get XGR standard schema', description: 'Retrieve machine-readable JSON schema for XGR standards.', inputSchema: { standard: z.enum(standardNames) } }, async ({ standard }) => ({ content: [{ type: 'text', text: JSON.stringify(standards[standard as StandardName].schema, null, 2) }] }));

  server.registerTool('list_xgr_standard_examples', { title: 'List XGR standard examples', description: 'List available example artifacts for a standard.', inputSchema: { standard: z.enum(standardNames) } }, async ({ standard }) => ({ content: [{ type: 'text', text: JSON.stringify(Object.keys(standards[standard as StandardName].examples), null, 2) }] }));

  server.registerTool('get_xgr_standard_example', { title: 'Get XGR standard example', description: 'Retrieve a concrete JSON example for XRC-137 or XRC-729.', inputSchema: { standard: z.enum(standardNames), name: z.string().min(1) } }, async ({ standard, name }) => { const examples = standards[standard as StandardName].examples as Record<string, unknown>; const example = examples[name]; if (!example) return { content: [{ type: 'text', text: JSON.stringify({ error: 'unknown example', available: Object.keys(examples) }, null, 2) }], isError: true }; return { content: [{ type: 'text', text: JSON.stringify(example, null, 2) }] }; });

  server.registerTool('get_xgr_multibundle_reference', { title: 'Get XGR MultiBundle reference', description: 'Retrieve canonical xgr-multi-bundle@1 Markdown documentation.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: xgrMultiBundleReference }] }));

  server.registerTool('get_xgr_multibundle_schema', { title: 'Get XGR MultiBundle schema', description: 'Retrieve canonical XGR MultiBundle schema.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify(xgrMultiBundleSchema, null, 2) }] }));

  server.registerTool('get_xgr_session_start_schema', { title: 'Get XGR Session Start schema', description: 'Retrieve canonical Workbench xgr-session-start@1 handoff schema.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify(xgrSessionStartSchema, null, 2) }] }));

  server.registerTool('validate_xgr_session_start', { title: 'Validate legacy XGR Session Start', description: 'Validate legacy low-level session-start payload only.', inputSchema: { sessionStart: z.record(z.string(), z.unknown()) } }, async ({ sessionStart }) => { const result = validateXgrSessionStart(sessionStart); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.valid }; });

  server.registerTool('validate_xgr_session_start_handoff', { title: 'Validate XGR Session Start Handoff', description: 'Validate a canonical Workbench xgr-session-start@1 request.', inputSchema: { request: z.record(z.string(), z.unknown()) } }, async ({ request }) => { const result = validateSessionStartRequest(request); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.valid }; });

  server.registerTool('validate_xgr_multibundle', { title: 'Validate XGR MultiBundle', description: 'Validate canonical deployable xgr-multi-bundle@1.', inputSchema: { bundle: z.record(z.string(), z.unknown()) } }, async ({ bundle }) => { const result = validateXgrMultiBundle(bundle); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.valid }; });

  server.registerTool('validate_xdala_bundle', { title: 'Validate XDaLa bundle', description: 'Alias for validate_xgr_multibundle.', inputSchema: { bundle: z.record(z.string(), z.unknown()) } }, async ({ bundle }) => { const result = validateXgrMultiBundle(bundle); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.valid }; });

  server.registerTool('validate_xrc137_authoring', { title: 'Validate XRC-137 authoring rules', description: 'Validate a drafted XRC-137 authoring object.', inputSchema: { rule: z.record(z.string(), z.unknown()) } }, async ({ rule }) => { const result = validateXrc137Authoring(rule); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.valid }; });

  server.registerTool('validate_xdala_rules', { title: 'Validate XDaLa rule expressions', description: 'Validate rule expressions against available placeholder fields.', inputSchema: { rules: z.array(z.unknown()), availableFields: z.array(z.string()).optional() } }, async ({ rules, availableFields = [] }) => { const result = validateXDaLaRules({ rules, availableFields }); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.valid }; });

  server.registerTool('validate_xdala_blueprint', { title: 'Validate XDaLa blueprint', description: 'Validate XRC-729 OSTC plus per-step XRC-137 payload-flow consistency.', inputSchema: { ostc: z.record(z.string(), z.unknown()), xrc137ByStep: z.record(z.string(), z.unknown()), entryStepId: z.string().min(1), initialPayloadFields: z.array(z.string()).optional() } }, async ({ ostc, xrc137ByStep, entryStepId, initialPayloadFields = [] }) => { const result = validateXDaLaBlueprint({ ostc, xrc137ByStep, entryStepId, initialPayloadFields }); return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.valid }; });
}
