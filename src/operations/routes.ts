import express, { type ExpressApp, type Request, type Response } from 'express';
import type { OperationStatus, PublicOperation, StepStatus } from './store.js';
import { getOperation, updateOperation } from './store.js';
import {
  getBundleDeployHandoff,
  isBundleDeployStatus,
  recordBundleDeployResult,
  updateBundleDeployHandoff,
  validateBundleDeployResult
} from './bundleDeployStore.js';
import {
  getSessionStartHandoff,
  recordSessionStartResult,
  validateSessionStartResult
} from './sessionStartStore.js';
import {
  containsSensitiveField,
  publicError,
  publicHandoffAcceptGuard,
  publicHandoffAudit,
  publicHandoffHandleGuard,
  publicHandoffHandleRateLimit,
  publicHandoffIpRateLimit,
  publicHandoffJsonContentTypeGuard,
  publicHandoffJsonParser,
  publicHandoffMethodNotAllowed,
  publicHandoffOriginGuard,
  publicJsonRaw,
  publicJsonRedacted
} from './publicHandoffSecurity.js';

const XGR_WEBSITE_URL = 'https://xgr.network';
const XGR_LOGO_URL = 'https://xgr.network/Graphics/brand/logo_tp.png';
const XGR_FOOTER_URL = 'https://xgr.network/footer.html';
const XGR_FOOTER_PROXY_PATH = '/api/xgr-footer';

function absolutizeXgrHtml(html: string): string {
  return html
    .replace(/\s(href|src)="\/(?!\/)([^"]*)"/g, (_match, attr: string, path: string) => ` ${attr}="${XGR_WEBSITE_URL}/${path}"`)
    .replace(/\s(href|src)='\/(?!\/)([^']*)'/g, (_match, attr: string, path: string) => ` ${attr}='${XGR_WEBSITE_URL}/${path}'`)
    .replace(/url\((['"]?)\/(?!\/)([^'")]+)\1\)/g, (_match, quote: string, path: string) => `url(${quote}${XGR_WEBSITE_URL}/${path}${quote})`);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html, text/css, */*'
    }
  });

  if (!response.ok) {
    throw new Error(`fetch ${url} failed with ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return new TextDecoder('utf-8').decode(buffer);
}

function extractXgrHeadLinks(siteHtml: string): string {
  const matches = siteHtml.match(/<link\b[^>]*(?:stylesheet|preload|modulepreload|icon)[^>]*>/gi) ?? [];
  const links = new Set<string>();

  for (const match of matches) {
    links.add(absolutizeXgrHtml(match));
  }

  return Array.from(links).join('\n');
}

function extractBodyHtml(html: string): string {
  const match = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1]?.trim() || html;
}



function pageHtml(operationId: string, secret: string): string {
  const safeId = JSON.stringify(operationId);
  const safeSecret = JSON.stringify(secret);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>XGR Operation</title>
  <style>
    :root {
      --xgr-green: #073f2f;
      --xgr-green-2: #0e6b45;
      --xgr-gold: #c9a94a;
      --xgr-bg: #f7faf7;
      --xgr-card: #ffffff;
      --xgr-text: #10231c;
      --xgr-muted: #63756d;
      --xgr-border: rgba(7, 63, 47, 0.14);
      --xgr-danger: #b42318;
      --xgr-danger-bg: #fff1f0;
      --xgr-ok: #087443;
      --xgr-ok-bg: #edfff5;
      --shadow: 0 18px 60px rgba(7, 63, 47, 0.10);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 78% 22%, rgba(112, 198, 118, 0.22), transparent 28rem),
        radial-gradient(circle at 8% 0%, rgba(201, 169, 74, 0.15), transparent 30rem),
        linear-gradient(180deg, #ffffff 0%, var(--xgr-bg) 100%);
      color: var(--xgr-text);
    }

    a {
      color: var(--xgr-green-2);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    header {
      border-bottom: 1px solid var(--xgr-border);
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(14px);
      position: sticky;
      top: 0;
      z-index: 5;
    }

    .header-inner {
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 14px;
      color: var(--xgr-text);
      font-weight: 850;
      letter-spacing: -0.03em;
      text-decoration: none;
      min-width: 0;
    }

    .brand:hover {
      text-decoration: none;
    }

    .brand-logo-box {
      width: 178px;
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      flex: 0 0 auto;
    }

    .brand-logo {
      display: block;
      width: 178px;
      max-width: 178px;
      height: auto;
      max-height: 46px;
      object-fit: contain;
    }

    .brand-logo-fallback {
      display: none;
      color: var(--xgr-green);
      font-size: 22px;
      font-weight: 950;
      letter-spacing: -0.04em;
      white-space: nowrap;
    }

    .brand-logo-box.logo-failed .brand-logo {
      display: none;
    }

    .brand-logo-box.logo-failed .brand-logo-fallback {
      display: block;
    }

    .brand-text {
      display: flex;
      flex-direction: column;
      line-height: 1.08;
      min-width: 0;
    }

    .brand-text span {
      white-space: nowrap;
    }

    .brand-text small {
      color: var(--xgr-muted);
      font-weight: 650;
      letter-spacing: 0;
      margin-top: 3px;
      white-space: nowrap;
    }

    .top-links {
      display: flex;
      align-items: center;
      gap: 14px;
      color: var(--xgr-muted);
      font-weight: 650;
      font-size: 14px;
      white-space: nowrap;
    }

    main {
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      padding: 34px 20px 42px;
      flex: 1;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.12fr) minmax(300px, 0.88fr);
      gap: 22px;
      align-items: stretch;
      margin-bottom: 22px;
    }

    .panel,
    .card {
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid var(--xgr-border);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }

    .panel {
      padding: 28px;
    }

    .card {
      padding: 22px;
      margin: 16px 0;
    }

    h1,
    h2,
    h3 {
      margin: 0;
      letter-spacing: -0.04em;
      color: var(--xgr-text);
    }

    h1 {
      font-size: clamp(34px, 5vw, 58px);
      line-height: 0.98;
      max-width: 780px;
    }

    h2 {
      font-size: 24px;
      margin-bottom: 14px;
    }

    h3 {
      font-size: 18px;
      margin-bottom: 8px;
    }

    p {
      line-height: 1.55;
    }

    .lead {
      color: var(--xgr-muted);
      font-size: 18px;
      max-width: 720px;
      margin: 16px 0 0;
    }

    .muted {
      color: var(--xgr-muted);
    }

    .danger {
      color: var(--xgr-danger);
    }

    .ok {
      color: var(--xgr-ok);
    }

    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--xgr-border);
      background: #fbfdfb;
      border-radius: 999px;
      padding: 7px 11px;
      color: var(--xgr-muted);
      font-size: 13px;
      font-weight: 700;
    }

    .status-grid {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    .kv {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(7, 63, 47, 0.08);
      font-size: 14px;
    }

    .kv:last-child {
      border-bottom: 0;
    }

    .kv span {
      color: var(--xgr-muted);
    }

    .kv b {
      color: var(--xgr-text);
      text-align: right;
      word-break: break-word;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }

    button {
      border: 0;
      background: var(--xgr-green);
      color: #fff;
      padding: 11px 16px;
      border-radius: 999px;
      cursor: pointer;
      font-weight: 800;
      box-shadow: 0 10px 24px rgba(7, 63, 47, 0.18);
    }

    button.secondary {
      background: #edf5f1;
      color: var(--xgr-green);
      box-shadow: none;
      border: 1px solid var(--xgr-border);
    }

    button:disabled {
      opacity: 0.52;
      cursor: not-allowed;
      box-shadow: none;
    }

    .notice {
      border-radius: 18px;
      padding: 14px 16px;
      margin: 14px 0 0;
      border: 1px solid var(--xgr-border);
      background: #f6fbf8;
      color: var(--xgr-muted);
    }

    .notice.danger-box {
      border-color: rgba(180, 35, 24, 0.22);
      background: var(--xgr-danger-bg);
      color: var(--xgr-danger);
    }

    .notice.ok-box {
      border-color: rgba(8, 116, 67, 0.22);
      background: var(--xgr-ok-bg);
      color: var(--xgr-ok);
    }

    .steps-list {
      display: grid;
      gap: 14px;
    }

    .step {
      padding: 18px;
      border: 1px solid var(--xgr-border);
      border-radius: 20px;
      background: #fbfdfb;
    }

    .step-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }

    .step-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0 0;
    }

    .tag {
      border-radius: 999px;
      background: #eef5f1;
      color: var(--xgr-muted);
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 750;
    }

    pre {
      overflow: auto;
      background: #f4f8f5;
      border: 1px solid var(--xgr-border);
      border-radius: 16px;
      padding: 14px;
      color: #122820;
      font-size: 12px;
      line-height: 1.45;
      max-height: 320px;
    }

    details {
      margin-top: 14px;
    }

    summary {
      cursor: pointer;
      color: var(--xgr-green);
      font-weight: 800;
      margin-bottom: 10px;
    }

    footer {
      margin-top: auto;
      border-top: 1px solid var(--xgr-border);
      background: #ffffff;
    }

    .xgr-site-footer-frame {
      display: block;
      width: 100%;
      min-height: 380px;
      border: 0;
      background: #ffffff;
    }

    .footer-fallback {
      display: none;
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      padding: 28px 20px;
      color: var(--xgr-muted);
    }

    .footer-fallback a {
      font-weight: 700;
    }

    footer.footer-frame-failed .xgr-site-footer-frame {
      display: none;
    }

    footer.footer-frame-failed .footer-fallback {
      display: block;
    }

    @media (max-width: 920px) {
      .brand-logo-box {
        width: 148px;
        height: 40px;
      }

      .brand-logo {
        width: 148px;
        max-width: 148px;
        max-height: 40px;
      }

      .brand-text {
        display: none;
      }
    }

    @media (max-width: 820px) {
      .hero {
        grid-template-columns: 1fr;
      }

      .top-links {
        display: none;
      }

      main {
        padding: 24px 14px 34px;
      }

      .panel,
      .card {
        border-radius: 20px;
      }

      .step-head {
        flex-direction: column;
      }

      .xgr-site-footer-frame {
        min-height: 460px;
      }
    }
  </style>
</head>
<body>
<div class="shell">
  <header>
    <div class="header-inner">
      <a class="brand" href="${XGR_WEBSITE_URL}" target="_blank" rel="noreferrer" aria-label="Open XGR Network website">
        <span class="brand-logo-box" aria-hidden="true">
          <img class="brand-logo" src="${XGR_LOGO_URL}" alt="" onerror="this.parentElement.classList.add('logo-failed')" />
          <span class="brand-logo-fallback">XGR Network</span>
        </span>
        <span class="brand-text">
          <span>XGR Network</span>
          <small>Operation Console</small>
        </span>
      </a>
      <nav class="top-links" aria-label="Top navigation">
        <a href="${XGR_WEBSITE_URL}" target="_blank" rel="noreferrer">Website</a>
        <a href="https://xdala.devnet.xgr.network" target="_blank" rel="noreferrer">XDaLa</a>
        <a href="https://explorer.devnet.xgr.network" target="_blank" rel="noreferrer">Explorer</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="panel">
        <h1>Review and execute locally.</h1>
        <p class="lead">
          Review the prepared operation and send each transaction with your browser wallet.
          The MCP never signs, submits, or auto-executes transactions.
        </p>
        <div class="pill-row">
          <span class="pill">Wallet-local signing</span>
          <span class="pill">MCP read/preparation only</span>
          <span class="pill">XGR Devnet compatible</span>
        </div>
        <div id="page-error"></div>
      </div>

      <section id="status" class="panel">Loading operation...</section>
    </section>

    <section id="steps" class="card"></section>

    <section class="card">
      <details>
        <summary>Raw operation</summary>
        <pre id="raw"></pre>
      </details>
    </section>
  </main>


</div>

<script>
const operationId = ${safeId};
const secret = ${safeSecret};

let operation = null;
let pageError = '';
let walletAddress = '';
const sendingSteps = new Set();

function el(id){
  return document.getElementById(id);
}

function hexChainId(n){
  return '0x' + Number(n || 0).toString(16);
}

function parseValue(value){
  try { return BigInt(String(value || '0')); } catch { return 0n; }
}

function shortAddress(value){
  const text = String(value || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return text;
  return text.slice(0, 6) + '...' + text.slice(-4);
}

function chainMetadata(_chainId){
  return null;
}

async function api(path, body){
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type':'application/json', 'accept':'application/json' } : { 'accept':'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    let message = '';
    try { message = await res.text(); } catch { message = res.statusText; }
    throw new Error(message || ('HTTP ' + res.status));
  }

  return res.json();
}

async function load(){
  pageError = '';
  operation = await api('/api/operations/' + encodeURIComponent(operationId) + '?k=' + encodeURIComponent(secret));
  operation = await api('/api/operations/' + encodeURIComponent(operationId) + '/status', {
    secret,
    status: 'opened'
  }).catch(() => operation);
  render();
}

function render(){
  if (!operation) return;

  const title = operation.summary?.title || operation.type || operation.id;
  const walletLine = walletAddress
    ? '<div class="notice ok-box"><b>Wallet connected:</b> ' + escapeHtml(shortAddress(walletAddress)) + '</div>'
    : '<div class="notice">Connect your wallet before sending a transaction.</div>';

  el('page-error').innerHTML = pageError
    ? '<div class="notice danger-box"><b>Error:</b> ' + escapeHtml(pageError) + '</div>'
    : '';

  el('status').innerHTML =
    '<h2>' + escapeHtml(title) + '</h2>' +
    '<div class="status-grid">' +
      '<div class="kv"><span>Status</span><b>' + escapeHtml(operation.status) + '</b></div>' +
      '<div class="kv"><span>Network</span><b>' + escapeHtml(operation.network) + '</b></div>' +
      '<div class="kv"><span>Chain ID</span><b>' + escapeHtml(String(operation.chainId)) + '</b></div>' +
      '<div class="kv"><span>Expires</span><b>' + escapeHtml(operation.expiresAt) + '</b></div>' +
      '<div class="kv"><span>User signature</span><b>' + escapeHtml(String(operation.policy?.requiresUserSignature)) + '</b></div>' +
      '<div class="kv"><span>Server may sign</span><b>' + escapeHtml(String(operation.policy?.serverMaySign)) + '</b></div>' +
      '<div class="kv"><span>Server may submit</span><b>' + escapeHtml(String(operation.policy?.serverMaySubmit)) + '</b></div>' +
    '</div>' +
    walletLine +
    '<div class="actions">' +
      '<button type="button" onclick="connectWallet()">' + (walletAddress ? 'Reconnect wallet' : 'Connect wallet') + '</button>' +
      '<button type="button" class="secondary" onclick="load()">Reload</button>' +
    '</div>';

  el('steps').innerHTML =
    '<h2>Steps</h2>' +
    '<div class="steps-list">' +
      ((operation.steps || []).length ? (operation.steps || []).map((s) => stepHtml(s)).join('') : '<p class="muted">No executable steps found.</p>') +
    '</div>';

  bindStepButtons();

  el('raw').textContent = JSON.stringify(operation, null, 2);
}

function stepHtml(s){
  const value = s.txRequest?.value || '0';
  const danger = parseValue(value) > 0n ? ' danger' : '';
  const disabled = !s.txRequest || ['submitted','confirmed','failed','skipped'].includes(s.status) || sendingSteps.has(s.id);
  const buttonLabel = sendingSteps.has(s.id) ? 'Waiting for wallet...' : 'Send with wallet';

  return '<article class="step">' +
    '<div class="step-head">' +
      '<div>' +
        '<h3>' + escapeHtml(s.label || s.id) + '</h3>' +
        '<div class="step-meta">' +
          '<span class="tag">Kind: ' + escapeHtml(s.kind) + '</span>' +
          '<span class="tag">Status: ' + escapeHtml(s.status) + '</span>' +
        '</div>' +
      '</div>' +
      '<button type="button" data-step-id="' + escapeHtml(s.id) + '" ' + (disabled ? 'disabled' : '') + '>' + escapeHtml(buttonLabel) + '</button>' +
    '</div>' +
    '<p class="' + danger + '"><b>Value wei:</b> ' + escapeHtml(String(value)) + '</p>' +
    (s.txHash ? '<p><b>Tx hash:</b> ' + escapeHtml(s.txHash) + '</p>' : '') +
    (s.error ? '<div class="notice danger-box"><b>Error:</b> ' + escapeHtml(s.error) + '</div>' : '') +
    (s.result !== undefined ? '<p><b>Result:</b></p><pre>' + escapeHtml(JSON.stringify(s.result, null, 2)) + '</pre>' : '') +
    '<details>' +
      '<summary>Transaction request preview</summary>' +
      '<pre>' + escapeHtml(JSON.stringify(s.txRequest || {}, null, 2)) + '</pre>' +
    '</details>' +
  '</article>';
}

function bindStepButtons(){
  document.querySelectorAll('button[data-step-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const stepId = button.getAttribute('data-step-id');
      if (stepId) sendStep(stepId);
    });
  });
}

async function ensureWalletChain(){
  const targetChainId = hexChainId(operation.chainId);
  const currentChainId = await window.ethereum.request({ method:'eth_chainId' });

  if (String(currentChainId).toLowerCase() === targetChainId.toLowerCase()) return;

  try {
    await window.ethereum.request({
      method:'wallet_switchEthereumChain',
      params:[{ chainId: targetChainId }]
    });
  } catch (err) {
    if (err?.code === 4902) {
      const metadata = chainMetadata(operation.chainId);
      if (!metadata) throw new Error('Wallet does not know chain ' + operation.chainId + ' and no add-chain metadata is configured.');

      await window.ethereum.request({
        method:'wallet_addEthereumChain',
        params:[metadata]
      });

      const afterAddChainId = await window.ethereum.request({ method:'eth_chainId' });
      if (String(afterAddChainId).toLowerCase() !== targetChainId.toLowerCase()) {
        await window.ethereum.request({
          method:'wallet_switchEthereumChain',
          params:[{ chainId: targetChainId }]
        });
      }
      return;
    }

    throw err;
  }
}

function normalizeQuantityField(tx, field){
  const value = tx[field];

  if (value === undefined || value === null || value === '') {
    delete tx[field];
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(field + ' must be a non-negative safe integer.');
    tx[field] = '0x' + value.toString(16);
    return;
  }

  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(field + ' must be non-negative.');
    tx[field] = '0x' + value.toString(16);
    return;
  }

  if (typeof value === 'string') {
    if (/^0x[0-9a-fA-F]+$/.test(value)) return;
    if (/^[0-9]+$/.test(value)) {
      tx[field] = '0x' + BigInt(value).toString(16);
      return;
    }
  }

  throw new Error(field + ' must be a non-negative integer decimal string, number, or 0x-prefixed hex string.');
}

function normalizeTransactionRequest(rawTx){
  const tx = { ...rawTx };

  for (const field of ['value','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','nonce']) {
    normalizeQuantityField(tx, field);
  }

  if ((tx.data === undefined || tx.data === null || tx.data === '') && tx.input !== undefined && tx.input !== null && tx.input !== '') {
    tx.data = tx.input;
  }

  delete tx.input;

  if (tx.data === undefined || tx.data === null || tx.data === '') tx.data = '0x';
  if (typeof tx.data !== 'string' || !tx.data.startsWith('0x')) throw new Error('data must be a 0x-prefixed hex string.');

  if (tx.to === undefined || tx.to === null || tx.to === '') {
    delete tx.to;
  } else if (typeof tx.to !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(tx.to)) {
    throw new Error('to must be a 0x-prefixed 20-byte address, or empty for contract creation.');
  }

  return tx;
}

function localStepError(stepId, message){
  const step = (operation.steps || []).find((s) => s.id === stepId);
  if (step) {
    step.status = 'failed';
    step.error = message;
  }
  operation.status = 'failed';
}

async function recordStepError(stepId, message){
  try {
    operation = await api('/api/operations/' + encodeURIComponent(operationId) + '/status', {
      secret,
      status:'failed',
      stepId,
      stepStatus:'failed',
      error: message
    });
  } catch (postErr) {
    console.error('Failed to record operation step error', postErr);
    localStepError(stepId, message);
  }
}

async function connectWallet(){
  if (!window.ethereum) {
    alert('No browser wallet found.');
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    walletAddress = accounts && accounts[0] ? accounts[0] : '';
    await ensureWalletChain();

    operation = await api('/api/operations/' + encodeURIComponent(operationId) + '/status', {
      secret,
      status:'wallet_connected'
    }).catch(() => operation);

    pageError = '';
  } catch (err) {
    console.error('Connect wallet failed', err);
    pageError = err?.message || String(err);
  }

  render();
}

async function sendStep(stepId){
  if (!window.ethereum) {
    alert('No browser wallet found.');
    return;
  }

  const step = (operation.steps || []).find((s) => s.id === stepId);
  if (!step?.txRequest) return;
  if (sendingSteps.has(stepId)) return;

  sendingSteps.add(stepId);
  render();

  try {
    pageError = '';

    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    walletAddress = accounts && accounts[0] ? accounts[0] : '';
    await ensureWalletChain();

    const tx = normalizeTransactionRequest(step.txRequest);
    if (!tx.from) tx.from = walletAddress || accounts[0];

    operation = await api('/api/operations/' + encodeURIComponent(operationId) + '/status', {
      secret,
      status:'tx_requested',
      stepId,
      stepStatus:'requested'
    }).catch(() => operation);

    const txHash = await window.ethereum.request({
      method:'eth_sendTransaction',
      params:[tx]
    });

    operation = await api('/api/operations/' + encodeURIComponent(operationId) + '/status', {
      secret,
      status:'tx_submitted',
      stepId,
      stepStatus:'submitted',
      txHash
    }).catch(() => operation);

    pageError = '';
  } catch (err) {
    console.error('Send with wallet failed', err);
    const message = err?.message || String(err);
    await recordStepError(stepId, message);
    pageError = message;
  } finally {
    sendingSteps.delete(stepId);
  }

  render();
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[m]));
}

function setupFooterFrame(){
  const footer = document.getElementById('xgr-footer');
  const frame = document.getElementById('xgr-footer-frame');

  if (!footer || !frame) return;

  const fallbackTimer = window.setTimeout(() => {
    footer.classList.add('footer-frame-failed');
  }, 6000);

  frame.addEventListener('load', () => {
    window.clearTimeout(fallbackTimer);

    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      const height = Math.max(
        doc?.body?.scrollHeight || 0,
        doc?.documentElement?.scrollHeight || 0,
        260
      );
      frame.style.height = height + 'px';
    } catch {
      frame.style.height = '380px';
    }
  });

  frame.addEventListener('error', () => {
    window.clearTimeout(fallbackTimer);
    footer.classList.add('footer-frame-failed');
  });
}

setupFooterFrame();

load().catch((err) => {
  const status = el('status');
  if (status) status.innerHTML = '<div class="notice danger-box"><b>Error:</b> ' + escapeHtml(err.message) + '</div>';
});
</script>
</body>
</html>`;
}

function bodyRecord(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
}

function secret(req: Request): string {
  const querySecret = req.query.k;
  if (typeof querySecret === 'string') return querySecret;
  const bodySecret = bodyRecord(req).secret;
  return typeof bodySecret === 'string' ? bodySecret : '';
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isFullOperation(operation: unknown): operation is PublicOperation {
  return Boolean(operation && typeof operation === 'object' && 'payload' in operation && 'events' in operation);
}

function operationStatus(value: unknown): OperationStatus | undefined {
  const status = stringField(value);
  return status && ['pending_user_action', 'opened', 'wallet_connected', 'tx_requested', 'tx_submitted', 'completed', 'failed', 'cancelled', 'expired'].includes(status) ? status as OperationStatus : undefined;
}

function stepStatus(value: unknown): StepStatus | undefined {
  const status = stringField(value);
  return status && ['pending', 'requested', 'submitted', 'confirmed', 'failed', 'skipped'].includes(status) ? status as StepStatus : undefined;
}

export function registerOperationRoutes(app: ExpressApp): void {
  const publicCommon = [publicHandoffAcceptGuard, publicHandoffOriginGuard, publicHandoffIpRateLimit];
  const publicPost = [publicHandoffJsonContentTypeGuard, publicHandoffJsonParser];

  app.get(
    '/api/session-start/:handle',
    publicHandoffAudit('/api/session-start/:handle'),
    ...publicCommon,
    publicHandoffHandleGuard('session-start'),
    publicHandoffHandleRateLimit('get'),
    async (req: Request, res: Response) => {
      const handoff = await getSessionStartHandoff(req.params.handle);
      if (!handoff) return publicError(res, 404, 'not found');
      if (handoff.status === 'expired') return publicError(res, 410, 'expired');
      publicJsonRaw(res, handoff);
    }
  );

  app.post(
    '/api/session-start/:handle/result',
    publicHandoffAudit('/api/session-start/:handle/result'),
    ...publicCommon,
    publicHandoffHandleGuard('session-start'),
    publicHandoffHandleRateLimit('result'),
    ...publicPost,
    async (req: Request, res: Response) => {
      const validation = validateSessionStartResult(req.params.handle, req.body);
      if (!validation.ok) return publicError(res, validation.statusCode, validation.statusCode === 400 ? 'bad request' : 'error', validation.error);
      const handoff = await recordSessionStartResult(req.params.handle, validation.result);
      if (!handoff) return publicError(res, 404, 'not found');
      if ('error' in handoff) return publicError(res, handoff.statusCode, handoff.statusCode === 409 ? 'conflict' : handoff.statusCode === 410 ? 'expired' : 'error', handoff.error);
      publicJsonRedacted(res, { ok: true, handle: handoff.handle, status: handoff.status });
    }
  );

  app.all('/api/session-start/:handle/result', publicHandoffAudit('/api/session-start/:handle/result'), ...publicCommon, publicHandoffMethodNotAllowed(['POST']));
  app.all('/api/session-start/:handle', publicHandoffAudit('/api/session-start/:handle'), ...publicCommon, publicHandoffMethodNotAllowed(['GET']));

  app.get(
    '/api/bundle-deploy/:handle',
    publicHandoffAudit('/api/bundle-deploy/:handle'),
    ...publicCommon,
    publicHandoffHandleGuard('bundle-deploy'),
    publicHandoffHandleRateLimit('get'),
    async (req: Request, res: Response) => {
      const handoff = await getBundleDeployHandoff(req.params.handle);
      if (!handoff) return publicError(res, 404, 'not found');
      if (handoff.status === 'expired') return publicError(res, 410, 'expired');
      publicJsonRaw(res, handoff);
    }
  );

  app.post(
    '/api/bundle-deploy/:handle/status',
    publicHandoffAudit('/api/bundle-deploy/:handle/status'),
    ...publicCommon,
    publicHandoffHandleGuard('bundle-deploy'),
    publicHandoffHandleRateLimit('status'),
    ...publicPost,
    async (req: Request, res: Response) => {
      const body = bodyRecord(req);
      if (containsSensitiveField(body)) return publicError(res, 400, 'bad request', 'request body contains a disallowed sensitive field');
      if (!isBundleDeployStatus(body.status)) return publicError(res, 400, 'bad request', 'invalid bundle deploy status');
      const handoff = await updateBundleDeployHandoff({
        handle: req.params.handle,
        status: body.status,
        txHashes: body.txHashes,
        contracts: body.contracts,
        error: stringField(body.error)
      });
      if (!handoff) return publicError(res, 404, 'not found');
      if (handoff.status === 'expired') return publicError(res, 410, 'expired');
      publicJsonRedacted(res, { ok: true, handle: handoff.handle, status: handoff.status });
    }
  );

  app.post(
    '/api/bundle-deploy/:handle/result',
    publicHandoffAudit('/api/bundle-deploy/:handle/result'),
    ...publicCommon,
    publicHandoffHandleGuard('bundle-deploy'),
    publicHandoffHandleRateLimit('result'),
    ...publicPost,
    async (req: Request, res: Response) => {
      if (containsSensitiveField(req.body)) return publicError(res, 400, 'bad request', 'request body contains a disallowed sensitive field');
      const validation = validateBundleDeployResult(req.params.handle, req.body);
      if (!validation.ok) return publicError(res, validation.statusCode, validation.statusCode === 400 ? 'bad request' : 'error', validation.error);

      const handoff = await recordBundleDeployResult({
        handle: req.params.handle,
        result: validation.result
      });
      if (!handoff) return publicError(res, 404, 'not found');
      if ('error' in handoff) return publicError(res, handoff.statusCode, handoff.statusCode === 409 ? 'conflict' : handoff.statusCode === 410 ? 'expired' : 'error', handoff.error);
      publicJsonRedacted(res, { ok: true, handle: handoff.handle, status: handoff.status });
    }
  );

  app.all('/api/bundle-deploy/:handle/status', publicHandoffAudit('/api/bundle-deploy/:handle/status'), ...publicCommon, publicHandoffMethodNotAllowed(['POST']));
  app.all('/api/bundle-deploy/:handle/result', publicHandoffAudit('/api/bundle-deploy/:handle/result'), ...publicCommon, publicHandoffMethodNotAllowed(['POST']));
  app.all('/api/bundle-deploy/:handle', publicHandoffAudit('/api/bundle-deploy/:handle'), ...publicCommon, publicHandoffMethodNotAllowed(['GET']));

app.get(XGR_FOOTER_PROXY_PATH, async (_req: Request, res: Response) => {
  const [siteHtml, footerHtml] = await Promise.all([
    fetchText(XGR_WEBSITE_URL),
    fetchText(XGR_FOOTER_URL)
  ]);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
});

  app.use(express.json({ limit: '4mb' }));

  app.get('/operations/:id', async (req: Request, res: Response) => {
    const operationSecret = secret(req);
    const operation = await getOperation(req.params.id, operationSecret);
    if (!operation || !operationSecret || !isFullOperation(operation)) return void res.status(404).send('Operation not found or token mismatch.');
    res.type('html').send(pageHtml(req.params.id, operationSecret));
  });

  app.get('/api/operations/:id', async (req: Request, res: Response) => {
    const operation = await getOperation(req.params.id, secret(req));
    if (!operation) return void res.status(404).json({ error: 'operation not found or token mismatch' });
    res.json(operation);
  });

  app.post('/api/operations/:id/status', async (req: Request, res: Response) => {
    const body = bodyRecord(req);
    const operation = await updateOperation({
      id: req.params.id,
      secret: secret(req),
      status: operationStatus(body.status),
      stepId: stringField(body.stepId),
      stepStatus: stepStatus(body.stepStatus),
      txHash: stringField(body.txHash),
      error: stringField(body.error),
      result: body.result
    });
    if (!operation) return void res.status(404).json({ error: 'operation not found or token mismatch' });
    res.json(operation);
  });
}
