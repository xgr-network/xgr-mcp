# XGR MCP Gateway

AI-native access to the XGR stack over the [Model Context Protocol](https://modelcontextprotocol.io). Connect any MCP-compatible agent — Claude, ChatGPT, IDE assistants, custom hosts — and read XGRChain, XDaLa sessions, Explorer data and XRC standards, or prepare owner-signed on-chain actions, in plain language.

The gateway never holds keys and never signs. Write intents are prepared as handoffs that you review and sign locally in your own wallet.

## Connect an agent

The gateway speaks MCP over HTTP at:

```
https://mcp.xgr.network/mcp
```

### Claude (Desktop / Web connectors)

Add a custom connector pointing at the URL above. Claude can then call the XGR tools directly in chat.

### Any MCP client

Point your client's MCP server config at the HTTP endpoint:

```json
{
  "mcpServers": {
    "xgr": {
      "type": "http",
      "url": "https://mcp.xgr.network/mcp"
    }
  }
}
```

That's the whole setup. No contract addresses, no XRC knowledge, no local infrastructure required — describe what you want and the agent resolves it against deployed processes.

## What you can do

- **Ask about the chain** — live status, blocks, account state.
- **Inspect sessions** — find, list, and explain XDaLa sessions, steps, payloads and receipts.
- **Search transactions** — chain-wide search, value transfers, account/block history, stats.
- **Explore XRC contracts** — XRC-137 rules and XRC-729 orchestrations, process graphs, reuse and failure analytics.
- **Draft & validate** — author XRC-137/XRC-729 artifacts and bundles against the built-in schemas and validators.
- **Prepare actions** — bundle deploys and session starts as review-and-sign handoffs (the gateway prepares; you sign locally).

## Documentation

Full reference lives in the central XGR docs:

- [Gateway Overview](https://xgr.network/docs/mcp_overview/)
- [Tool Reference](https://xgr.network/docs/mcp_tools/)
- [Operation Handoff](https://xgr.network/docs/mcp_handoff/)
- [Authoring & Knowledge](https://xgr.network/docs/mcp_knowledge/)

## Self-hosting

The gateway is operable against your own XGRChain RPC and Explorer instance. Self-hosting additionally requires an Explorer deployment with a read-only Postgres mirror for the transaction-search and session-analytics tools. See [Setup & Configuration](https://xgr.network/docs/mcp_setup/).

## License

See [LICENSE](./LICENSE).
