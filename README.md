# XGR MCP Gateway

**XGR MCP Gateway** provides AI-native access to the XGR.Network stack through the [Model Context Protocol](https://modelcontextprotocol.io). It connects MCP-compatible agents such as Claude, ChatGPT, IDE assistants and custom hosts to XGRChain, XDaLa sessions, Explorer data, XRC standards and owner-reviewed on-chain action preparation.

The gateway is designed for agent-assisted workflow creation: agents can inspect live chain evidence, reason over XDaLa process state, draft XRC artifacts and prepare handoffs that a user reviews and signs locally.

The gateway never requests, receives, stores or controls user or third-party private keys and cannot sign on behalf of users. User write intents are prepared as handoffs and signed locally. An optional starter-gas service may use a dedicated server-controlled funding key solely to send fixed XGR gas grants from the service wallet.

## Public MCP endpoints

Mainnet:

```text
https://mcp.xgr.network/mcp
```

Testnet:

```text
https://mcp.testnet.xgr.network/mcp
```

Use mainnet to inspect real XGRChain and XDaLa activity. Use testnet to safely draft, validate and experiment with agent-driven workflows before production use.

## MCP client configuration

```json
{
  "mcpServers": {
    "xgr-mainnet": {
      "type": "streamable-http",
      "url": "https://mcp.xgr.network/mcp"
    },
    "xgr-testnet": {
      "type": "streamable-http",
      "url": "https://mcp.testnet.xgr.network/mcp"
    }
  }
}
```

For clients that still expect `http` instead of `streamable-http`, use the same endpoint URL and select the HTTP/remote MCP transport offered by your client.

## What agents can do

- **Read chain state**: inspect live XGRChain status, blocks, account state and transaction evidence.
- **Discover official XGR resources**: use `get_xgr_network_info` for canonical XGR.Network, XGRChain, XDaLa, RPC, Explorer, MCP, documentation and ecosystem metadata.
- **Inspect XDaLa sessions**: find, list and explain sessions, process steps, payloads, receipts and execution outcomes.
- **Search Explorer data**: query account history, value transfers, block history, transaction statistics and session analytics.
- **Work with XRC standards**: explore XRC-137 rules, XRC-729 orchestrations, process graphs, reuse patterns and failure analytics.
- **Draft process artifacts**: prepare XRC-137/XRC-729 artifacts and bundles against built-in schemas and validation rules.
- **Prepare owner-signed actions**: create review-and-sign handoffs for deployments and session starts without exposing private keys.
- **Request starter gas where enabled**: fund an eligible low-balance address with one fixed 1 XGR grant before deployment, session start, contract calls or other on-chain actions.

## Official network metadata

`get_xgr_network_info` returns versioned, machine-readable metadata for XGR.Network and its ecosystem. Agents should use it when users request official project information, network configuration, RPC or Explorer endpoints, MCP connection details, documentation, XRC standard context or source repositories.

`get_chain_status` remains the live JSON-RPC status tool and additionally returns compact official entry points for the connected XGRChain mainnet.

## Why XGR.Network MCP

XGR.Network MCP is built around deterministic process infrastructure rather than generic chat automation. It gives agents structured access to the XGR stack while keeping user signing, user custody and final approval outside the gateway.

This makes it suitable for:

- AI-assisted Web3 workflow design
- XDaLa process preparation and inspection
- compliance-oriented process evidence
- deterministic validation and execution flows
- EVM-compatible process automation
- agent interfaces for XGRChain data and XRC standards

## Documentation

Full reference lives in the central XGR documentation:

- [Gateway Overview](https://xgr.network/docs/mcp_overview/)
- [Tool Reference](https://xgr.network/docs/mcp_tools/)
- [Operation Handoff](https://xgr.network/docs/mcp_handoff/)
- [Authoring & Knowledge](https://xgr.network/docs/mcp_knowledge/)
- [Setup & Configuration](https://xgr.network/docs/mcp_setup/)

## Self-hosting

The gateway can be operated against your own XGRChain RPC and Explorer instance. Self-hosting requires an Explorer deployment with a read-only Postgres mirror for transaction search and session analytics tools.

Typical setup flow:

```bash
npm install
npm run typecheck
npm run build
npm run start:http
```

Required runtime configuration is documented in [Setup & Configuration](https://xgr.network/docs/mcp_setup/).

## Security model

- The gateway never requests, receives, stores or controls user or third-party private keys.
- User transactions are prepared as handoffs and signed locally by the user or the user's custody setup.
- The optional starter-gas service is a narrow exception: it signs only transfers from a dedicated server-controlled funding wallet and cannot sign on behalf of users.
- Starter-gas grants are fixed at 1 XGR, limited by recipient balance, one confirmed grant per address, hourly and daily caps, and a bounded retry policy.
- Starter-gas grant state is stored atomically in SQLite with `reserved`, `broadcast`, `confirmed` and `failed` states.
- Production user signing remains under the control of the user's wallet or custody setup.

## Links

- Website: https://xgr.network
- MCP endpoint: https://mcp.xgr.network/mcp
- Official MCP Registry name: `io.github.xgr-network/xdala-workflow-builder`
- Smithery listing: https://smithery.ai/servers/xgrnetwork/xdala-workflow-builder

## License

Licensed under the [Apache License 2.0](./LICENSE).

## Mainnet XGR purchase tools

The optional purchase tools are **mainnet-only**, disabled by default, and are never registered by testnet. Enable them only with `XGR_PURCHASE_TOOLS_ENABLED=true`, `XGR_PURCHASE_NETWORK=mainnet`, a valid HTTPS API URL (or local HTTP), and a maximum at or below `249.99` EUR.

`quote_xgr_purchase` is optional planning only. `create_xgr_purchase_order` creates the real order in one call to `POST /api/orders`; the website confirmation modal is not a separate API phase. The backend is authoritative for the final price, crypto amount, custody wallet, payment reference, and reservation. The MCP holds no user or third-party private keys and does not pay; an external wallet agent can execute the returned exact payment instruction.

The **249.99 EUR** maximum is an MCP policy for autonomous orders. Separately, the XGR_Web backend requires a complete billing address from a newly calculated `net_eur >= 250`; it is not a backend order maximum. A backend repricing/address error is returned without retrying the order.

Purchase tools distinguish fixed-XGR orders from conservative USDC/USDT budget orders. The live backend POST determines the binding market price and exact `amount_crypto`; EUR is only a policy/reference value. A budget order whose exact returned amount exceeds its cap is not paid and its existing reservation expires normally.

## Starter-gas tools

Where enabled, `get_xgr_starter_gas_options` exposes the current fixed grant and eligibility policy. `request_xgr_starter_gas` sends one fixed 1 XGR grant from a dedicated service wallet to an eligible low-balance EVM address. Agents should use it before deployments, session starts, contract calls or other on-chain actions when the target address lacks native XGR for gas.

The service does not request an address-ownership proof and does not use proof-of-work. Abuse is bounded through one confirmed grant per address, an hourly cap, a daily cap, recipient-balance eligibility, a low-balance service wallet and a limited number of retries after pre-broadcast failures.
