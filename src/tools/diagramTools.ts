import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getBundleDeployHandoff } from '../operations/bundleDeployStore.js';
import {
  renderBundleMermaid,
  renderRuntimeMermaid,
  validateBundleForMermaid,
  validationErrorsAsWarnings,
  type XdalaMermaidDirection
} from '../knowledge/xdalaMermaid.js';

function toolJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
}

const sourceSchema = z.enum(['runtime', 'bundle', 'bundle_handoff']);
const directionSchema = z.enum(['TD', 'LR']);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export function registerDiagramTools(server: McpServer): void {
  server.registerTool(
    'get_xdala_process_mermaid',
    {
      title: 'Get XDaLa process Mermaid',
      description: 'Render an XDaLa XRC-729 process graph from runtime, bundle, or bundle handoff data as Mermaid flowchart text. Read-only; does not sign, submit, or execute transactions.',
      inputSchema: {
        source: sourceSchema,
        xrc729Address: addressSchema.optional(),
        ostcId: z.string().min(1).optional(),
        includeRules: z.boolean().optional(),
        bundle: z.record(z.string(), z.unknown()).optional(),
        handle: z.string().min(1).optional(),
        direction: directionSchema.optional(),
        includeAddresses: z.boolean().optional(),
        includeRuleSummary: z.boolean().optional(),
        includePayloadFields: z.boolean().optional(),
        includeWarnings: z.boolean().optional()
      }
    },
    async (input) => {
      const options = {
        direction: (input.direction ?? 'LR') as XdalaMermaidDirection,
        includeRules: input.includeRules ?? true,
        includeAddresses: input.includeAddresses ?? false,
        includeRuleSummary: input.includeRuleSummary ?? true,
        includePayloadFields: input.includePayloadFields ?? false,
        includeWarnings: input.includeWarnings ?? true
      };

      try {
        if (input.source === 'runtime') {
          if (!input.xrc729Address) return { content: [{ type: 'text' as const, text: toolJson({ error: 'xrc729Address is required for source="runtime".' }) }], isError: true };
          if (!input.ostcId) return { content: [{ type: 'text' as const, text: toolJson({ error: 'ostcId is required for source="runtime" because this tool cannot infer an OSTC id without the indexed resolver.' }) }], isError: true };
          return { content: [{ type: 'text' as const, text: toolJson(await renderRuntimeMermaid({ xrc729Address: input.xrc729Address, ostcId: input.ostcId }, options)) }] };
        }

        if (input.source === 'bundle') {
          if (!input.bundle) return { content: [{ type: 'text' as const, text: toolJson({ error: 'bundle is required for source="bundle".' }) }], isError: true };
          const validation = validateBundleForMermaid(input.bundle);
          if (!validation.ok) {
            return {
              content: [{ type: 'text' as const, text: toolJson({ error: 'invalid xgr-multi-bundle@1', validation: validation.validation, warnings: validationErrorsAsWarnings(validation.validation.errors) }) }],
              isError: true
            };
          }
          return { content: [{ type: 'text' as const, text: toolJson(renderBundleMermaid('bundle', input.bundle, options)) }] };
        }

        if (!input.handle) return { content: [{ type: 'text' as const, text: toolJson({ error: 'handle is required for source="bundle_handoff".' }) }], isError: true };
        const handoff = await getBundleDeployHandoff(input.handle, { mutateExpired: false });
        if (!handoff) return { content: [{ type: 'text' as const, text: toolJson({ error: 'bundle deploy handoff not found' }) }], isError: true };
        if (handoff.status === 'expired') return { content: [{ type: 'text' as const, text: toolJson({ error: `bundle deploy handoff expired at ${handoff.expiresAt}` }) }], isError: true };
        const validation = validateBundleForMermaid(handoff.bundle);
        if (!validation.ok) {
          return {
            content: [{ type: 'text' as const, text: toolJson({ error: 'stored handoff bundle is not a valid xgr-multi-bundle@1', validation: validation.validation, warnings: validationErrorsAsWarnings(validation.validation.errors) }) }],
            isError: true
          };
        }
        return { content: [{ type: 'text' as const, text: toolJson(renderBundleMermaid('bundle_handoff', handoff.bundle, options)) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: toolJson({ error: error instanceof Error ? error.message : String(error) }) }], isError: true };
      }
    }
  );
}
