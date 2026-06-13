import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const XGR_TREE_URL = 'https://api.github.com/repos/xgr-network/XGR/git/trees/main?recursive=1';
const BUNDLED_DOCS_DIR = resolve('dist', 'knowledge', 'xgr-docs');
const LOADER_DOCS_DIR = resolve('XGR', 'docs');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function githubHeaders(accept) {
  const headers = {
    accept,
    'user-agent': 'xgr-mcp-gateway-build'
  };
  if (GITHUB_TOKEN) headers.authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function getJson(url) {
  const response = await fetch(url, { headers: githubHeaders('application/vnd.github+json') });
  if (!response.ok) throw new Error(`[sync-xgr-docs] HTTP ${response.status} for ${url}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers: githubHeaders('application/vnd.github.raw') });
  if (!response.ok) throw new Error(`[sync-xgr-docs] HTTP ${response.status} for ${url}`);
  return response.text();
}

function safeRelativeDocPath(path) {
  if (!path.startsWith('docs/') || path.includes('..')) throw new Error(`[sync-xgr-docs] Refusing unsafe docs path ${path}`);
  return path.slice('docs/'.length);
}

function writeDoc(baseDir, relativePath, content) {
  const target = resolve(baseDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

const tree = await getJson(XGR_TREE_URL);
const docs = tree.tree.filter((item) => item.type === 'blob' && item.path.startsWith('docs/'));
if (docs.length === 0) throw new Error('[sync-xgr-docs] No docs found in fixed XGR repository.');

for (const item of docs) {
  const relativePath = safeRelativeDocPath(item.path);
  const content = await getText(item.url);
  writeDoc(BUNDLED_DOCS_DIR, relativePath, content);
  writeDoc(LOADER_DOCS_DIR, relativePath, content);
}

console.log(`[sync-xgr-docs] Synced ${docs.length} docs from https://github.com/xgr-network/XGR into ${LOADER_DOCS_DIR}`);
