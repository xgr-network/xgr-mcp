import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cwd, env } from 'node:process';

export const knowledgeDocTopics = [
  'xdala-authoring',
  'xrc-137-rule-document',
  'xrc-137-contract',
  'xrc-729-contract',
  'xrc-729-orchestration',
  'expression-evaluation',
  'mcp-authoring',
  'mcp-tools',
  'xrc-137',
  'xrc-729',
  'rules',
  'api-calls',
  'contract-reads',
  'xgr-multibundle'
] as const;

export type KnowledgeDocTopic = typeof knowledgeDocTopics[number];

const topicFiles: Record<KnowledgeDocTopic, string> = {
  'xdala-authoring': 'XDaLa_Agent_Authoring_Rules.md',
  'xrc-137-rule-document': 'XRC-137_Rule_Document_Spec.md',
  'xrc-137-contract': 'XRC-137_Smart_Contract_Standard.md',
  'xrc-729-contract': 'XRC-729_Smart_Contract_Standard.md',
  'xrc-729-orchestration': 'xrc_729_orchestration_session_manager.md',
  'expression-evaluation': 'xgr_expression_evaluation_developer_guide.md',
  'mcp-authoring': join('mcp', 'XGR-MCP-Authoring-and-Knowledge.md'),
  'mcp-tools': join('mcp', 'XGR-MCP-Tool-Reference.md'),
  'xrc-137': 'XRC-137_Rule_Document_Spec.md',
  'xrc-729': 'xrc_729_orchestration_session_manager.md',
  rules: 'xgr_expression_evaluation_developer_guide.md',
  'api-calls': 'XRC-137_Rule_Document_Spec.md',
  'contract-reads': 'XRC-137_Rule_Document_Spec.md',
  'xgr-multibundle': join('mcp', 'XGR-MCP-Authoring-and-Knowledge.md')
};

function xgrDocsCandidates(): string[] {
  return [
    env.XGR_DOCS_DIR,
    env.XGR_REPO_DIR ? join(env.XGR_REPO_DIR, 'docs') : undefined,
    join(cwd(), '..', 'XGR', 'docs'),
    join(cwd(), '..', '..', 'XGR', 'docs'),
    join(cwd(), 'XGR', 'docs')
  ].filter((item): item is string => Boolean(item && item.trim()));
}

function resolveXgrDocPath(relativePath: string): string {
  const candidates = xgrDocsCandidates().map((baseDir) => resolve(baseDir, relativePath));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `XGR documentation not found for ${relativePath}. Set XGR_DOCS_DIR to the xgr-network/XGR/docs directory or deploy xgr-mcp-gateway next to an XGR checkout.`
    );
  }
  return found;
}

export function getKnowledgeDoc(topic: KnowledgeDocTopic): string {
  return readFileSync(resolveXgrDocPath(topicFiles[topic]), 'utf8');
}

export function listKnowledgeDocTopics(): KnowledgeDocTopic[] {
  return [...knowledgeDocTopics];
}

export const xdalaAuthoringRules = getKnowledgeDoc('xdala-authoring');
export const xrc137Reference = getKnowledgeDoc('xrc-137-rule-document');
export const xrc729Reference = getKnowledgeDoc('xrc-729-orchestration');
export const xgrMultiBundleReference = getKnowledgeDoc('mcp-authoring');
