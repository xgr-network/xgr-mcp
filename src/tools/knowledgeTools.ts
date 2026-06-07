import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { xdalaAuthoringRules } from '../knowledge/xdalaAuthoring.js';
import { validateXDaLaBlueprint, validateXrc137Authoring } from '../knowledge/xdalaValidator.js';
import { validateSessionStartRequest } from '../operations/sessionStartStore.js';
import { xrc137Examples, xrc137Reference, xrc137Schema } from '../knowledge/xrc137.js';
import { xrc729Examples, xrc729Reference, xrc729Schema } from '../knowledge/xrc729.js';
import {
  xgrMultiBundleReference,
  xgrMultiBundleSchema,
  xgrSessionStartSchema,
  validateXgrMultiBundle,
  validateXgrSessionStart
} from '../knowledge/multiBundle.js';

const standards = {
  'xrc-137': {
    reference: xrc137Reference,
    schema: xrc137Schema,
    examples: xrc137Examples
  },
  'xrc-729': {
    reference: xrc729Reference,
    schema: xrc729Schema,
    examples: xrc729Examples
  },
  'xdala-authoring': {
    reference: xdalaAuthoringRules,
    schema: {},
    examples: {}
  },
  'xgr-multibundle': {
    reference: xgrMultiBundleReference,
    schema: xgrMultiBundleSchema,
    examples: {}
  }
} as const;

const standardNames = ['xrc-137', 'xrc-729', 'xdala-authoring', 'xgr-multibundle'] as const;
type StandardName = keyof typeof standards;

export function registerKnowledgeTools(server: McpServer): void {
  server.registerTool(
    'list_xgr_standards',
    {
      title: 'List XGR standards',
      description: 'Use this to list agent-readable XGR and XDaLa standards available in the MCP knowledge base. Includes xdala-authoring for agent drafting rules.',
      inputSchema: {}
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(Object.keys(standards), null, 2) }]
    })
  );

  server.registerTool(
    'get_xdala_authoring_rules',
    {
      title: 'Get XDaLa authoring rules',
      description: 'Use this before creating, modifying or reviewing XRC-137, XRC-729, XDaLa payloads, runbooks or Workbench handoff JSON. It explains payload schema rules, placeholder syntax, apiCalls, rules and validation requirements.',
      inputSchema: {}
    },
    async () => ({
      content: [{ type: 'text', text: xdalaAuthoringRules }]
    })
  );

  server.registerTool(
    'get_xgr_standard_reference',
    {
      title: 'Get XGR standard reference',
      description: 'Use this before drafting XRC-137 or XRC-729 artifacts. For agent authoring guardrails use standard=xdala-authoring or get_xdala_authoring_rules.',
      inputSchema: {
        standard: z.enum(standardNames)
      }
    },
    async ({ standard }) => ({
      content: [{ type: 'text', text: standards[standard as StandardName].reference }]
    })
  );

  server.registerTool(
    'get_xgr_standard_schema',
    {
      title: 'Get XGR standard schema',
      description: 'Use this to retrieve the machine-readable JSON schema for XRC-137 or XRC-729 drafts. xdala-authoring returns an empty schema because it is a prose authoring guide.',
      inputSchema: {
        standard: z.enum(standardNames)
      }
    },
    async ({ standard }) => ({
      content: [{ type: 'text', text: JSON.stringify(standards[standard as StandardName].schema, null, 2) }]
    })
  );

  server.registerTool(
    'list_xgr_standard_examples',
    {
      title: 'List XGR standard examples',
      description: 'Use this to list available example artifacts for XRC-137 or XRC-729.',
      inputSchema: {
        standard: z.enum(standardNames)
      }
    },
    async ({ standard }) => ({
      content: [{ type: 'text', text: JSON.stringify(Object.keys(standards[standard as StandardName].examples), null, 2) }]
    })
  );

  server.registerTool(
    'get_xgr_standard_example',
    {
      title: 'Get XGR standard example',
      description: 'Use this to retrieve a concrete JSON example for XRC-137 or XRC-729. Examples are meant as drafting guidance and should still be validated before production use.',
      inputSchema: {
        standard: z.enum(standardNames),
        name: z.string().min(1)
      }
    },
    async ({ standard, name }) => {
      const examples = standards[standard as StandardName].examples as Record<string, unknown>;
      const example = examples[name];
      if (!example) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'unknown example', available: Object.keys(examples) }, null, 2) }],
          isError: true
        };
      }

      return { content: [{ type: 'text', text: JSON.stringify(example, null, 2) }] };
    }
  );

  server.registerTool(
    'get_xgr_multibundle_reference',
    {
      title: 'Get XGR MultiBundle reference',
      description: 'Use this before generating a complete XRC-729/XRC-137 process bundle. It explains canonical xgr-multi-bundle@1 format.',
      inputSchema: {}
    },
    async () => ({
      content: [{ type: 'text', text: xgrMultiBundleReference }]
    })
  );

  server.registerTool(
    'get_xgr_multibundle_schema',
    {
      title: 'Get XGR MultiBundle schema',
      description: 'Use this to retrieve the canonical XGR MultiBundle schema for xgr-multi-bundle@1.',
      inputSchema: {}
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(xgrMultiBundleSchema, null, 2) }]
    })
  );

  server.registerTool(
    'get_xgr_session_start_schema',
    {
      title: 'Get XGR Session Start schema',
      description: 'Use this to retrieve the canonical Workbench Session Start Handoff schema: xgr-session-start@1 with type=xdala_session_start and sessions[].stepId, sessions[].payload and sessions[].maxTotalGas. Do not use entryStepId for Workbench Session Start.',
      inputSchema: {}
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(xgrSessionStartSchema, null, 2) }]
    })
  );

  server.registerTool(
    'validate_xgr_session_start',
    {
      title: 'Validate legacy XGR Session Start',
      description: 'This validates the legacy low-level session-start payload only. It is not the canonical Workbench handoff schema. For Workbench use create_xdala_session_start_handoff and xgr-session-start@1 with sessions[].stepId, sessions[].payload and sessions[].maxTotalGas. Do not put this legacy object into the MultiBundle.',
      inputSchema: {
        sessionStart: z.record(z.string(), z.unknown())
      }
    },
    async ({ sessionStart }) => {
      const result = validateXgrSessionStart(sessionStart);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.valid
      };
    }
  );

  server.registerTool(
    'validate_xgr_session_start_handoff',
    {
      title: 'Validate XGR Session Start Handoff',
      description: 'Validate a canonical Workbench xgr-session-start@1 request with type=xdala_session_start and sessions[].stepId, sessions[].payload and sessions[].maxTotalGas. This is the Workbench handoff validator; do not use entryStepId.',
      inputSchema: {
        request: z.record(z.string(), z.unknown())
      }
    },
    async ({ request }) => {
      const result = validateSessionStartRequest(request);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.valid
      };
    }
  );

  server.registerTool(
    'validate_xgr_multibundle',
    {
      title: 'Validate XGR MultiBundle',
      description: 'Use this before presenting a generated complete XRC-729/XRC-137 bundle as final. It validates canonical deployable xgr-multi-bundle@1 only; session start handoffs must use create_xdala_session_start_handoff or get_xgr_session_start_schema for canonical xgr-session-start@1 guidance. It rejects root validation metadata and bundle-level initialPayload, entryStepId and requiredDeployments.',
      inputSchema: {
        bundle: z.record(z.string(), z.unknown())
      }
    },
    async ({ bundle }) => {
      const result = validateXgrMultiBundle(bundle);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.valid
      };
    }
  );

  server.registerTool(
    'validate_xdala_bundle',
    {
      title: 'Validate XDaLa bundle',
      description: 'Alias for validate_xgr_multibundle. Validates canonical deployable xgr-multi-bundle@1 only; session start handoffs must use create_xdala_session_start_handoff or get_xgr_session_start_schema for canonical xgr-session-start@1 guidance. It rejects root validation metadata and bundle-level initialPayload, entryStepId and requiredDeployments.',
      inputSchema: {
        bundle: z.record(z.string(), z.unknown())
      }
    },
    async ({ bundle }) => {
      const result = validateXgrMultiBundle(bundle);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.valid
      };
    }
  );

  server.registerTool(
    'validate_xrc137_authoring',
    {
      title: 'Validate XRC-137 authoring rules',
      description: 'Use this after drafting an XRC-137 rule and before presenting it as final. It catches common agent authoring errors such as payload.value, payload.expr, generic apiCalls id/url/extract, generic rule expr/id, and non-XDaLa placeholder syntax.',
      inputSchema: {
        rule: z.record(z.string(), z.unknown())
      }
    },
    async ({ rule }) => {
      const result = validateXrc137Authoring(rule);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.valid
      };
    }
  );

  server.registerTool(
    'validate_xdala_blueprint',
    {
      title: 'Validate XDaLa blueprint',
      description: 'Use this after drafting an XRC-729 OSTC plus per-step XRC-137 drafts. It checks node names, spawn targets, join targets, join from nodes, k-of-n thresholds and whether required XRC-137 input fields are provided by initial payload or predecessor output payloads. It is a blueprint consistency validator, not a replacement for validate_xrc137_authoring.',
      inputSchema: {
        ostc: z.record(z.string(), z.unknown()),
        xrc137ByStep: z.record(z.string(), z.unknown()),
        entryStepId: z.string().min(1),
        initialPayloadFields: z.array(z.string()).optional()
      }
    },
    async ({ ostc, xrc137ByStep, entryStepId, initialPayloadFields = [] }) => {
      const result = validateXDaLaBlueprint({ ostc, xrc137ByStep, entryStepId, initialPayloadFields });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.valid
      };
    }
  );
}
