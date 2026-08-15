import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPurchaseConfig } from '../src/shared/purchaseConfig.js';
import { registerPurchaseTools } from '../src/tools/purchaseTools.js';

type ToolOptions = {
  description?: string;
  inputSchema?: Record<string, unknown>;
};
type Tool = {
  options: ToolOptions;
  handler: (
    input: Record<string, unknown>,
  ) => Promise<{ content: Array<{ text: string }> }>;
};
type Routes = Record<string, unknown>;
const enabled = () =>
  getPurchaseConfig({
    XGR_PURCHASE_TOOLS_ENABLED: 'true',
    XGR_PURCHASE_NETWORK: 'mainnet',
    XGR_PURCHASE_API_BASE_URL: 'https://xgr.network',
  });
function registered(config = enabled()): Map<string, Tool> {
  const found = new Map<string, Tool>();
  registerPurchaseTools(
    {
      registerTool(
        name: string,
        options: unknown,
        handler: Tool['handler'],
      ) {
        found.set(name, { options: options as ToolOptions, handler });
      },
    } as unknown as McpServer,
    config,
  );
  return found;
}
function parse(value: { content: Array<{ text: string }> }) {
  return JSON.parse(value.content[0].text) as Record<string, unknown>;
}
const price = {
  price_eur: 0.03,
  market_price_usdc_per_xgr: 0.04,
  discounted_usdc_per_xgr: 0.02,
  usdc_per_eur: 1.1,
  price_source: 'market',
  fx_source: 'fx',
  quote_at: '2026-01-01T00:00:00Z',
  fx_quote_at: '2026-01-01T00:00:00Z',
};
const order = {
  ok: true,
  order_uid: 'o1',
  payment_reference: 'r1',
  amount_xgr: 100,
  amount_crypto: 2,
  payment_method: 'crypto',
  payment_asset: 'usdc',
  custody_wallet: '0x1111111111111111111111111111111111111111',
  reserved_until: '2026-01-02T00:00:00Z',
  sender_wallet: '0x3333333333333333333333333333333333333333',
  chain_id: 1643,
};
function mock(routes: Routes, postCount: { value: number }) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const key = init?.method === 'POST' ? 'POST' : new URL(url).pathname;
    if (key === 'POST') postCount.value++;
    const body = routes[key];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}
function routes(symbol = 'USDC', available = 10000): Routes {
  return {
    '/api/xgr-price': price,
    '/api/xgr-availability': {
      available,
      reserved_sum: 0,
      stock_check_disabled: false,
    },
    '/api/payment-assets': {
      assets: [
        {
          key: 'usdc',
          symbol,
          chain: 'ethereum',
          decimals: 6,
          requires_sender_wallet: true,
        },
        {
          key: 'usdt',
          symbol: 'USDT',
          chain: 'ethereum',
          decimals: 6,
          requires_sender_wallet: false,
        },
      ],
    },
    POST: order,
  };
}
const input = {
  payment_asset: 'usdc',
  name: 'Agent',
  email: 'a@example.com',
  country_code: 'DE',
  xgr_wallet: '0x2222222222222222222222222222222222222222',
  sender_wallet: '0x3333333333333333333333333333333333333333',
  terms_accepted: true,
};
const expectedInstruction = {
  type: 'crypto_transfer',
  chain: 'ethereum',
  asset_key: 'usdc',
  symbol: 'USDC',
  decimals: 6,
  amount: 2,
  recipient: '0x1111111111111111111111111111111111111111',
  sender_wallet: '0x3333333333333333333333333333333333333333',
  reference: 'r1',
  expires_at: '2026-01-02T00:00:00Z',
  xgr_delivery: {
    chain_id: 1643,
    wallet: '0x2222222222222222222222222222222222222222',
    amount_xgr: 100,
  },
};

test('configuration gates tools and exposes agent workflow descriptions', () => {
  assert.equal(registered(getPurchaseConfig({})).size, 0);
  assert.equal(
    registered(
      getPurchaseConfig({
        XGR_PURCHASE_TOOLS_ENABLED: 'true',
        XGR_PURCHASE_NETWORK: 'testnet',
        XGR_PURCHASE_MAX_EUR: '999',
      }),
    ).size,
    0,
  );
  assert.throws(() =>
    getPurchaseConfig({
      XGR_PURCHASE_TOOLS_ENABLED: 'true',
      XGR_PURCHASE_NETWORK: 'mainnet',
    }),
  );
  const tools = registered();
  assert.deepEqual([...tools.keys()], [
    'get_xgr_purchase_options',
    'quote_xgr_purchase',
    'create_xgr_purchase_order',
    'create_xgr_purchase_order_by_budget',
  ]);
  assert.match(
    tools.get('get_xgr_purchase_options')!.options.description ?? '',
    /Call this first/,
  );
  assert.match(
    tools.get('create_xgr_purchase_order_by_budget')!.options.description ??
      '',
    /Pay only when payment_approved=true/,
  );
});
test('options expose real price fields, machine-readable agent guidance and quote planning', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  mock(routes(), { value: 0 });
  const tools = registered();
  const options = parse(
    await tools.get('get_xgr_purchase_options')!.handler({}),
  );
  const p = options.price as Record<string, unknown>;
  assert.equal(p.quote_at, price.quote_at);
  assert.equal(Object.hasOwn(p, 'quoted_at'), false);
  const guidance = options.agent_guidance as Record<string, unknown>;
  assert.equal(guidance.payment_asset_field, 'payment_assets[].key');
  assert.equal(guidance.payment_source, 'payment_instruction');
  const quote = parse(
    await tools
      .get('quote_xgr_purchase')!
      .handler({ max_payment_amount: 2.1, payment_asset: 'usdc' }),
  );
  assert.equal(quote.safety_margin_bps, 100);
  assert.equal(quote.estimated_amount_xgr, 103);
  assert.equal(
    quote.next_action,
    'create_order_after_required_user_inputs_are_confirmed',
  );
});
test('fixed and budget orders use one backend post and return exact agent payment instructions', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const posts = { value: 0 };
  mock(routes(), posts);
  const tools = registered();
  const fixed = parse(
    await tools
      .get('create_xgr_purchase_order')!
      .handler({ ...input, amount_xgr: 100 }),
  );
  assert.deepEqual(fixed.order, order);
  assert.equal(fixed.payment_approved, true);
  assert.equal(fixed.next_action, 'external_crypto_payment');
  assert.deepEqual(fixed.payment_instruction, expectedInstruction);
  const budget = parse(
    await tools
      .get('create_xgr_purchase_order_by_budget')!
      .handler({ ...input, max_payment_amount: 2.02 }),
  );
  assert.equal(budget.payment_approved, true);
  assert.equal(budget.next_action, 'external_crypto_payment');
  assert.deepEqual(budget.payment_instruction, expectedInstruction);
  assert.equal(posts.value, 2);
});
test('budget overrun blocks payment after one post and omits payment instruction', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const posts = { value: 0 };
  mock(
    {
      ...routes(),
      POST: { ...order, amount_xgr: 103, amount_crypto: 2.11 },
    },
    posts,
  );
  const over = parse(
    await registered()
      .get('create_xgr_purchase_order_by_budget')!
      .handler({ ...input, max_payment_amount: 2.1 }),
  );
  assert.equal(over.order_created, true);
  assert.equal(over.payment_approved, false);
  assert.equal(over.payment_within_limit, false);
  assert.equal(over.payment_execution, 'blocked');
  assert.equal(over.next_action, 'do_not_pay');
  assert.equal(Object.hasOwn(over, 'payment_instruction'), false);
  assert.equal(over.exact_payment_amount, 2.11);
  assert.equal(posts.value, 1);
});

test('zero stock with a valid USDC asset fails before post', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  const posts = { value: 0 };
  mock(routes('USDC', 0), posts);
  const value = parse(
    await registered()
      .get('quote_xgr_purchase')!
      .handler({ max_payment_amount: 2.1, payment_asset: 'usdc' }),
  );
  assert.match(
    String((value.error as Record<string, unknown>).message),
    /Insufficient XGR availability/,
  );
  assert.equal(value.next_action, 'fix_input_or_retry');
  assert.equal(posts.value, 0);
});

test('fixed order treats invalid 2xx JSON as a possibly created blocked order', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let posts = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      return new Response('not-json', { status: 200 });
    }
    const key = new URL(url).pathname;
    return new Response(JSON.stringify(routes()[key]), { status: 200 });
  }) as typeof fetch;
  const value = parse(
    await registered()
      .get('create_xgr_purchase_order')!
      .handler({ ...input, amount_xgr: 100 }),
  );
  assert.equal(value.order_created, 'unknown');
  assert.equal(value.post_completed, true);
  assert.equal(value.payment_execution, 'blocked');
  assert.equal(value.next_action, 'do_not_pay');
  assert.equal(value.raw_order_response, 'not-json');
  assert.equal(
    (value.error as Record<string, unknown>).http_status,
    200,
  );
  assert.equal(posts, 1);
});

test('budget order treats invalid 2xx JSON as a possibly created blocked order', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let posts = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      return new Response('not-json', { status: 200 });
    }
    return new Response(JSON.stringify(routes()[new URL(url).pathname]), {
      status: 200,
    });
  }) as typeof fetch;
  const value = parse(
    await registered()
      .get('create_xgr_purchase_order_by_budget')!
      .handler({ ...input, max_payment_amount: 2.1 }),
  );
  assert.equal(value.order_created, 'unknown');
  assert.equal(value.post_completed, true);
  assert.equal(value.next_action, 'do_not_pay');
  assert.equal(value.raw_order_response, 'not-json');
  assert.equal(posts, 1);
});

test('post HTTP errors remain pre-post failures', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return new Response('backend error', { status: 500 });
    return new Response(JSON.stringify(routes()[new URL(url).pathname]), {
      status: 200,
    });
  }) as typeof fetch;
  const value = parse(
    await registered()
      .get('create_xgr_purchase_order')!
      .handler({ ...input, amount_xgr: 100 }),
  );
  assert.equal(value.order_created, false);
  assert.equal(value.post_completed, false);
  assert.equal(value.next_action, 'fix_input_or_retry');
  assert.equal(
    (value.error as Record<string, unknown>).http_status,
    500,
  );
});

test('fixed order blocks a mismatched backend XGR amount after one post', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let posts = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      return new Response(JSON.stringify({ ...order, amount_xgr: 99 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(routes()[new URL(url).pathname]), {
      status: 200,
    });
  }) as typeof fetch;
  const value = parse(
    await registered()
      .get('create_xgr_purchase_order')!
      .handler({ ...input, amount_xgr: 100 }),
  );
  assert.equal(value.order_created, true);
  assert.equal(value.post_completed, true);
  assert.equal(value.payment_execution, 'blocked');
  assert.equal(value.next_action, 'do_not_pay');
  assert.match(
    String((value.error as Record<string, unknown>).message),
    /unexpected amount_xgr/,
  );
  assert.equal(posts, 1);
});

test('budget order blocks a mismatched backend XGR amount after one post', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let posts = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      return new Response(JSON.stringify({ ...order, amount_xgr: 1 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(routes()[new URL(url).pathname]), {
      status: 200,
    });
  }) as typeof fetch;
  const value = parse(
    await registered()
      .get('create_xgr_purchase_order_by_budget')!
      .handler({ ...input, max_payment_amount: 2.1 }),
  );
  assert.equal(value.order_created, true);
  assert.equal(value.post_completed, true);
  assert.equal(value.payment_execution, 'blocked');
  assert.equal(value.next_action, 'do_not_pay');
  assert.equal(posts, 1);
});

test('fixed order posts exactly the supported backend payload', async (t) => {
  const old = fetch;
  t.after(() => {
    globalThis.fetch = old;
  });
  let postCount = 0;
  let posted: unknown;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      postCount++;
      posted = JSON.parse(String(init.body));
      return new Response(JSON.stringify(order), { status: 200 });
    }
    return new Response(JSON.stringify(routes()[new URL(url).pathname]), {
      status: 200,
    });
  }) as typeof fetch;
  await registered()
    .get('create_xgr_purchase_order')!
    .handler({ ...input, amount_xgr: 100 });
  assert.deepEqual(posted, {
    wallet: '0x2222222222222222222222222222222222222222',
    email: 'a@example.com',
    name: 'Agent',
    address: { street: '', city: '', country_code: 'DE', country: 'DE' },
    amount_xgr: 100,
    payment_method: 'crypto',
    payment_asset: 'usdc',
    sender_wallet: '0x3333333333333333333333333333333333333333',
  });
  assert.equal(postCount, 1);
});
