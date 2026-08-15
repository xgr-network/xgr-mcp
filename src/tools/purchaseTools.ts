import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  purchaseApiClient,
  PurchaseApiError,
  PurchaseApiResponseError,
} from '../adapters/purchaseApiClient.js';
import type { PurchaseConfig } from '../shared/purchaseConfig.js';
import {
  XGR_PURCHASE_CHAIN_ID,
  XGR_BILLING_ADDRESS_THRESHOLD_EUR,
} from '../shared/purchaseConfig.js';

type Json = Record<string, unknown>;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const countryPattern = /^[A-Z]{2}$/;
const result = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
});
function prePostFailure(error: unknown) {
  const api = error instanceof PurchaseApiError ? error : undefined;
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          order_created: false,
          post_completed: false,
          next_action: 'fix_input_or_retry',
          error: {
            type: api ? 'purchase_api_error' : 'validation_error',
            endpoint: api?.endpoint,
            http_status: api?.status,
            message: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 500),
          },
        }),
      },
    ],
  };
}
function postOrderFailure(
  rawOrderResponse: unknown,
  error: unknown,
  status = 200,
  endpoint = '/api/orders',
) {
  const raw =
    rawOrderResponse && typeof rawOrderResponse === 'object'
      ? (rawOrderResponse as Json)
      : undefined;
  const created =
    raw?.ok === true &&
    typeof raw.order_uid === 'string' &&
    raw.order_uid.trim() !== ''
      ? true
      : 'unknown';
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          order_created: created,
          post_completed: true,
          payment_approved: false,
          payment_execution: 'blocked',
          next_action: 'do_not_pay',
          raw_order_response: rawOrderResponse,
          error: {
            type: 'invalid_order_response',
            endpoint,
            http_status: status,
            message: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 500),
          },
        }),
      },
    ],
  };
}
function object(value: unknown, name: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${name} response.`);
  return value as Json;
}
function positive(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`Invalid ${name} in purchase API response.`);
  return n;
}
function nonNegative(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`Invalid ${name} in purchase API response.`);
  return n;
}
function nonNegativeInteger(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`Invalid ${name} in purchase API response.`);
  return n;
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid ${name} in purchase API response.`);
  return value.trim();
}
function list(value: unknown): Json[] {
  const entries = object(value, 'payment assets').assets;
  if (!Array.isArray(entries))
    throw new Error('Invalid payment assets response.');
  return entries.map((entry) => object(entry, 'payment asset'));
}
function assetKey(asset: Json): string {
  if (typeof asset.key !== 'string')
    throw new Error('Invalid payment asset key.');
  return asset.key;
}
function validateEstimate(eur: number, config: PurchaseConfig): void {
  if (eur < 2) throw new Error('Estimated order value must be at least 2 EUR.');
  if (!config.maxEur || eur > config.maxEur)
    throw new Error(
      `Estimated order value exceeds the ${config.maxEur} EUR MCP policy.`,
    );
}
async function market(config: PurchaseConfig, asset: string) {
  const client = purchaseApiClient(config);
  const [priceResponse, availabilityResponse, assetsResponse] =
    await Promise.all([
      client.price(),
      client.availability(),
      client.paymentAssets(),
    ]);
  const price = object(priceResponse, 'price');
  const availability = object(availabilityResponse, 'availability');
  const paymentAsset = list(assetsResponse).find(
    (candidate) => assetKey(candidate) === asset,
  );
  if (!paymentAsset)
    throw new Error(
      'payment_asset is not currently available. Call get_xgr_purchase_options and use payment_assets[].key exactly.',
    );
  const priceEur = positive(price.price_eur, 'price_eur');
  const available = nonNegative(availability.available, 'available');
  return { client, price, availability, paymentAsset, priceEur, available };
}
function orderPayload(input: Json, amount: number): Json {
  const payload: Json = {
    wallet: input.xgr_wallet,
    email: input.email,
    name: input.name,
    address: {
      street: '',
      city: '',
      country_code: input.country_code,
      country: input.country_code,
    },
    amount_xgr: amount,
    payment_method: 'crypto',
    payment_asset: input.payment_asset,
  };
  if (input.sender_wallet) payload.sender_wallet = input.sender_wallet;
  return payload;
}
function validateOrder(
  orderValue: unknown,
  asset: string,
  expectedAmountXgr: number,
): Json {
  const order = object(orderValue, 'order');
  if (order.ok !== true)
    throw new Error('Successful order response has ok !== true.');
  if (typeof order.order_uid !== 'string' || order.order_uid.trim() === '')
    throw new Error('Successful order response is missing order_uid.');
  if (
    typeof order.payment_reference !== 'string' ||
    order.payment_reference.trim() === ''
  )
    throw new Error('Successful order response is missing payment_reference.');
  if (!Number.isInteger(order.amount_xgr) || Number(order.amount_xgr) <= 0)
    throw new Error(
      'Successful order response contains an invalid amount_xgr.',
    );
  if (order.amount_xgr !== expectedAmountXgr)
    throw new Error(
      'Successful order response contains an unexpected amount_xgr.',
    );
  try {
    positive(order.amount_crypto, 'amount_crypto');
  } catch {
    throw new Error(
      'Successful order response contains an invalid amount_crypto.',
    );
  }
  if (order.payment_method !== 'crypto')
    throw new Error(
      'Successful order response contains an invalid payment_method.',
    );
  if (order.payment_asset !== asset)
    throw new Error(
      'Successful order response contains the wrong payment_asset.',
    );
  if (
    typeof order.custody_wallet !== 'string' ||
    !addressPattern.test(order.custody_wallet)
  )
    throw new Error(
      'Successful order response contains an invalid custody_wallet.',
    );
  if (
    typeof order.reserved_until !== 'string' ||
    order.reserved_until.trim() === ''
  )
    throw new Error('Successful order response is missing reserved_until.');
  if (order.chain_id !== XGR_PURCHASE_CHAIN_ID)
    throw new Error('Successful order response contains the wrong chain_id.');
  return order;
}
function paymentInstruction(
  order: Json,
  paymentAsset: Json,
  xgrWallet: unknown,
): Json {
  return {
    type: 'crypto_transfer',
    chain: requiredString(paymentAsset.chain, 'payment asset chain'),
    asset_key: requiredString(order.payment_asset, 'payment_asset'),
    symbol: requiredString(paymentAsset.symbol, 'payment asset symbol'),
    decimals: nonNegativeInteger(
      paymentAsset.decimals,
      'payment asset decimals',
    ),
    amount: positive(order.amount_crypto, 'amount_crypto'),
    recipient: requiredString(order.custody_wallet, 'custody_wallet'),
    sender_wallet:
      typeof order.sender_wallet === 'string' &&
      order.sender_wallet.trim() !== ''
        ? order.sender_wallet
        : undefined,
    reference: requiredString(order.payment_reference, 'payment_reference'),
    expires_at: requiredString(order.reserved_until, 'reserved_until'),
    xgr_delivery: {
      chain_id: XGR_PURCHASE_CHAIN_ID,
      wallet: requiredString(xgrWallet, 'xgr_wallet'),
      amount_xgr: positive(order.amount_xgr, 'amount_xgr'),
    },
  };
}
function basicSchema() {
  return {
    payment_asset: z
      .string()
      .min(1)
      .describe(
        'Exact payment_assets[].key returned by get_xgr_purchase_options, for example usdc_eth. Do not use the display symbol.',
      ),
    name: z
      .string()
      .min(1)
      .describe('Purchaser name supplied by the user. Do not invent it.'),
    email: z
      .string()
      .email()
      .describe('Purchaser email supplied by the user. Do not invent it.'),
    country_code: z
      .string()
      .regex(countryPattern)
      .describe(
        'Two-letter uppercase country code supplied by the user, for example DE.',
      ),
    xgr_wallet: z
      .string()
      .regex(addressPattern)
      .describe(
        'User-controlled XGRChain wallet that will receive the purchased XGR.',
      ),
    sender_wallet: z
      .string()
      .regex(addressPattern)
      .optional()
      .describe(
        'User-controlled wallet that will send the stablecoin payment on the listed payment chain. Required when the selected payment asset has requires_sender_wallet=true.',
      ),
    terms_accepted: z
      .literal(true)
      .describe(
        'Set to true only after the user explicitly accepts the purchase terms. Never infer or invent acceptance.',
      ),
  };
}
async function budgetPlan(
  config: PurchaseConfig,
  amount: number,
  asset: string,
  margin: number,
) {
  const data = await market(config, asset);
  const rawSymbol = data.paymentAsset.symbol;
  if (typeof rawSymbol !== 'string' || rawSymbol.trim() === '')
    throw new Error('Invalid payment asset symbol.');
  const symbol = rawSymbol.trim().toUpperCase();
  if (symbol !== 'USDC' && symbol !== 'USDT')
    throw new Error(
      'Budget purchases support USDC and USDT payment assets only.',
    );
  const discounted = positive(
    data.price.discounted_usdc_per_xgr,
    'discounted_usdc_per_xgr',
  );
  const conservative = discounted * (1 + margin / 10_000);
  const xgr = Math.floor(amount / conservative);
  if (xgr <= 0) throw new Error('Payment budget is too small for one XGR.');
  const estimatedEur = xgr * data.priceEur;
  validateEstimate(estimatedEur, config);
  if (data.available < xgr) throw new Error('Insufficient XGR availability.');
  return {
    data,
    xgr,
    discounted,
    conservative,
    estimatedEur,
    estimatedPayment: xgr * discounted,
  };
}
export function registerPurchaseTools(
  server: McpServer,
  config: PurchaseConfig,
): void {
  if (!config.enabled) return;
  const budgetSchema = {
    max_payment_amount: z
      .number()
      .positive()
      .describe(
        'Maximum amount of the selected payment asset the user authorizes. This is USDC or USDT, not EUR.',
      ),
    payment_asset: z
      .string()
      .min(1)
      .describe(
        'Exact payment_assets[].key returned by get_xgr_purchase_options, for example usdc_eth. Do not use the display symbol.',
      ),
    safety_margin_bps: z
      .number()
      .int()
      .min(0)
      .max(1000)
      .optional()
      .describe(
        'Conservative planning margin in basis points. Omit to use the default 100 bps.',
      ),
  };
  server.registerTool(
    'get_xgr_purchase_options',
    {
      title: 'Get XGR purchase options',
      description:
        'Call this first for every XGR purchase. Read live price, stock and payment assets; use payment_assets[].key exactly as payment_asset and inspect requires_sender_wallet before creating an order.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const client = purchaseApiClient(config);
        const [assetsResponse, priceResponse, availabilityResponse] =
          await Promise.all([
            client.paymentAssets(),
            client.price(),
            client.availability(),
          ]);
        const price = object(priceResponse, 'price');
        const availability = object(availabilityResponse, 'availability');
        return result({
          network: 'mainnet',
          chain_id: XGR_PURCHASE_CHAIN_ID,
          autonomous_max_eur: config.maxEur,
          billing_address_threshold_eur: XGR_BILLING_ADDRESS_THRESHOLD_EUR,
          minimum_order_eur: 2,
          agent_guidance: {
            first_tool: 'get_xgr_purchase_options',
            payment_asset_field: 'payment_assets[].key',
            fixed_xgr_tool: 'create_xgr_purchase_order',
            budget_tool: 'create_xgr_purchase_order_by_budget',
            do_not_invent: [
              'name',
              'email',
              'country_code',
              'xgr_wallet',
              'sender_wallet',
              'terms_accepted',
            ],
            order_creation_effect: 'creates_live_reservation',
            payment_rule:
              'pay_only_when_payment_approved_is_true_and_next_action_is_external_crypto_payment',
            payment_source: 'payment_instruction',
          },
          price: {
            price_eur: positive(price.price_eur, 'price_eur'),
            market_price_usdc_per_xgr: positive(
              price.market_price_usdc_per_xgr,
              'market_price_usdc_per_xgr',
            ),
            discounted_usdc_per_xgr: positive(
              price.discounted_usdc_per_xgr,
              'discounted_usdc_per_xgr',
            ),
            usdc_per_eur: positive(price.usdc_per_eur, 'usdc_per_eur'),
            price_source: price.price_source,
            fx_source: price.fx_source,
            quote_at: price.quote_at,
            fx_quote_at: price.fx_quote_at,
          },
          availability: {
            available_xgr: nonNegative(availability.available, 'available'),
            reserved_xgr: nonNegative(
              availability.reserved_sum,
              'reserved_sum',
            ),
            stock_check_disabled: availability.stock_check_disabled === true,
          },
          payment_assets: list(assetsResponse),
        });
      } catch (error) {
        return prePostFailure(error);
      }
    },
  );
  server.registerTool(
    'quote_xgr_purchase',
    {
      title: 'Quote XGR purchase budget',
      description:
        'Use only when the user specifies a maximum USDC/USDT payment budget. Call get_xgr_purchase_options first, pass payment_assets[].key, and treat this result as planning only: it creates no order and is not a payment instruction.',
      inputSchema: budgetSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const plan = await budgetPlan(
          config,
          input.max_payment_amount,
          input.payment_asset,
          input.safety_margin_bps ?? 100,
        );
        return result({
          estimate_only: true,
          order_created: false,
          payment_amount_is_final: false,
          next_action: 'create_order_after_required_user_inputs_are_confirmed',
          payment_asset: input.payment_asset,
          requested_max_payment_amount: input.max_payment_amount,
          discounted_usdc_per_xgr: plan.discounted,
          conservative_price: plan.conservative,
          safety_margin_bps: input.safety_margin_bps ?? 100,
          estimated_amount_xgr: plan.xgr,
          estimated_payment_amount: plan.estimatedPayment,
          estimated_eur: plan.estimatedEur,
          available_xgr: plan.data.available,
          price_source: plan.data.price.price_source,
          quote_at: plan.data.price.quote_at,
        });
      } catch (error) {
        return prePostFailure(error);
      }
    },
  );
  server.registerTool(
    'create_xgr_purchase_order',
    {
      title: 'Create XGR purchase order',
      description:
        'Use when the user specifies an exact integer amount_xgr. Call get_xgr_purchase_options first, use payment_assets[].key, collect user-supplied identity and wallet fields, require explicit terms acceptance, and create one live reservation. Pay only from the returned payment_instruction.',
      inputSchema: {
        ...basicSchema(),
        amount_xgr: z
          .number()
          .int()
          .positive()
          .describe('Exact integer XGR amount requested by the user.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      let rawOrder: unknown;
      let paymentAsset: Json | undefined;
      try {
        const data = await market(config, input.payment_asset);
        paymentAsset = data.paymentAsset;
        validateEstimate(input.amount_xgr * data.priceEur, config);
        if (data.available < input.amount_xgr)
          throw new Error('Insufficient XGR availability.');
        if (
          data.paymentAsset.requires_sender_wallet === true &&
          !input.sender_wallet
        )
          throw new Error('sender_wallet is required for this payment asset.');
        rawOrder = await data.client.createOrder(
          orderPayload(input, input.amount_xgr),
        );
      } catch (error) {
        if (error instanceof PurchaseApiResponseError)
          return postOrderFailure(
            error.rawResponse,
            error,
            error.status,
            error.endpoint,
          );
        return prePostFailure(error);
      }
      try {
        const order = validateOrder(
          rawOrder,
          input.payment_asset,
          input.amount_xgr,
        );
        if (!paymentAsset)
          throw new Error('Missing validated payment asset context.');
        return result({
          network: 'mainnet',
          autonomous: true,
          order_created: true,
          payment_approved: true,
          payment_execution: 'external',
          next_action: 'external_crypto_payment',
          payment_instruction_exact: true,
          payment_instruction: paymentInstruction(
            order,
            paymentAsset,
            input.xgr_wallet,
          ),
          order,
        });
      } catch (error) {
        return postOrderFailure(rawOrder, error);
      }
    },
  );
  server.registerTool(
    'create_xgr_purchase_order_by_budget',
    {
      title: 'Create XGR purchase order by budget',
      description:
        'Use when the user specifies a maximum USDC/USDT payment amount rather than an XGR quantity. Call get_xgr_purchase_options first, use payment_assets[].key, collect user-supplied identity and wallet fields, require explicit terms acceptance, and create one live reservation. Pay only when payment_approved=true and next_action=external_crypto_payment; otherwise do not pay.',
      inputSchema: { ...basicSchema(), ...budgetSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      let rawOrder: unknown;
      let plan: Awaited<ReturnType<typeof budgetPlan>>;
      try {
        plan = await budgetPlan(
          config,
          input.max_payment_amount,
          input.payment_asset,
          input.safety_margin_bps ?? 100,
        );
        if (
          plan.data.paymentAsset.requires_sender_wallet === true &&
          !input.sender_wallet
        )
          throw new Error('sender_wallet is required for this payment asset.');
        rawOrder = await plan.data.client.createOrder(
          orderPayload(input, plan.xgr),
        );
      } catch (error) {
        if (error instanceof PurchaseApiResponseError)
          return postOrderFailure(
            error.rawResponse,
            error,
            error.status,
            error.endpoint,
          );
        return prePostFailure(error);
      }
      try {
        const order = validateOrder(rawOrder, input.payment_asset, plan.xgr);
        const exact = positive(order.amount_crypto, 'amount_crypto');
        const approved = exact <= input.max_payment_amount;
        return result({
          network: 'mainnet',
          autonomous: true,
          budget_mode: true,
          order_created: true,
          requested_max_payment_amount: input.max_payment_amount,
          payment_asset: input.payment_asset,
          safety_margin_bps: input.safety_margin_bps ?? 100,
          estimated_payment_amount: plan.estimatedPayment,
          exact_payment_amount: exact,
          payment_within_limit: approved,
          payment_approved: approved,
          payment_execution: approved ? 'external' : 'blocked',
          next_action: approved ? 'external_crypto_payment' : 'do_not_pay',
          payment_instruction_exact: true,
          ...(approved
            ? {
                payment_instruction: paymentInstruction(
                  order,
                  plan.data.paymentAsset,
                  input.xgr_wallet,
                ),
              }
            : {
                reason:
                  'Exact order payment amount exceeds the requested payment limit.',
              }),
          order,
        });
      } catch (error) {
        return postOrderFailure(rawOrder, error);
      }
    },
  );
}
