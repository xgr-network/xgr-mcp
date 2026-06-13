import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const XGR_TREE_URL = 'https://api.github.com/repos/xgr-network/XGR/git/trees/main?recursive=1';
const XGR_RAW_BASE_URL = 'https://raw.githubusercontent.com/xgr-network/XGR/main';
const BUNDLED_DOCS_DIR = resolve('dist', 'knowledge', 'xgr-docs');
const LOADER_DOCS_DIR = resolve('XGR', 'docs');
const SKIP_SYNC = process.env.XGR_SKIP_DOCS_SYNC === '1' || process.env.SKIP_XGR_DOCS_SYNC === '1';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function requestHeaders(accept) {
  return {
    accept,
    'user-agent': 'xgr-mcp-gateway-build',
    ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {})
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: requestHeaders('application/vnd.github+json') });
  if (!response.ok) throw new Error(`[sync-xgr-docs] HTTP ${response.status} for ${url}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers: requestHeaders('text/plain, application/vnd.github.raw') });
  if (!response.ok) throw new Error(`[sync-xgr-docs] HTTP ${response.status} for ${url}`);
  return response.text();
}

function safeRelativeDocPath(path) {
  if (!path.startsWith('docs/') || path.includes('..')) throw new Error(`[sync-xgr-docs] Refusing unsafe docs path ${path}`);
  return path.slice('docs/'.length);
}

function rawDocUrl(path) {
  return `${XGR_RAW_BASE_URL}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function writeDoc(baseDir, relativePath, content) {
  const target = resolve(baseDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function existingDocsAvailable() {
  const candidates = [
    LOADER_DOCS_DIR,
    process.env.XGR_DOCS_DIR,
    process.env.XGR_REPO_DIR ? resolve(process.env.XGR_REPO_DIR, 'docs') : undefined,
    resolve('..', 'XGR', 'docs'),
    resolve('..', '..', 'XGR', 'docs')
  ].filter(Boolean);

  return candidates.some((candidate) => existsSync(candidate));
}

async function syncDocs() {
  if (SKIP_SYNC) {
    console.warn('[sync-xgr-docs] Skipping remote docs sync because XGR_SKIP_DOCS_SYNC/SKIP_XGR_DOCS_SYNC is set.');
    return;
  }

  const tree = await getJson(XGR_TREE_URL);
  const docs = tree.tree.filter((item) => item.type === 'blob' && item.path.startsWith('docs/'));
  if (docs.length === 0) throw new Error('[sync-xgr-docs] No docs found in fixed XGR repository.');

  for (const item of docs) {
    const relativePath = safeRelativeDocPath(item.path);
    const content = await getText(rawDocUrl(item.path));
    writeDoc(BUNDLED_DOCS_DIR, relativePath, content);
    writeDoc(LOADER_DOCS_DIR, relativePath, content);
  }

  console.log(`[sync-xgr-docs] Synced ${docs.length} docs from https://github.com/xgr-network/XGR into ${LOADER_DOCS_DIR}`);
}

try {
  await syncDocs();
} catch (error) {
  if (existingDocsAvailable()) {
    console.warn(`[sync-xgr-docs] Remote docs sync failed, using existing local docs: ${error instanceof Error ? error.message : String(error)}`);
  } else {
    throw error;
  }
}
