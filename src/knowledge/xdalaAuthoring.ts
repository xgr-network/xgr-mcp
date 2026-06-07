export const xdalaAuthoringRules = `# XDaLa Agent Authoring Rules

Use this before drafting, modifying or reviewing XRC-137, XRC-729, XDaLa payloads, runbooks or Workbench handoff artifacts.

## Authoring mode

When the user asks to create, draft, modify, deploy, validate or execute XDaLa processes, XRC-137 rules, XRC-729 orchestrations, payloads or runbooks, enter XDaLa Authoring Mode.

Do not rely on memory or generic workflow JSON conventions. Use the XDaLa schema and MCP validation tools.

Never present generated XRC-137/XRC-729 JSON as final unless validation passed through a real MCP/xgrEngine validator. If validation cannot be executed, mark the output as:

DRAFT ONLY - NOT VALIDATED

and state the missing MCP tool or validation step.

## XRC-137 payload

XRC-137 payload is input schema only.

Allowed per payload field:

{
  "type": "string",
  "default": "optional-default"
}

Invalid in payload fields:
- value
- expr
- source
- dollar-input references
- dollar-brace template references
- dollar-api references

value and expr are not payload-schema keys.

## TypedValue contexts

value belongs only in TypedValue contexts, for example:
- apiCalls[].extractMap.<alias>.value
- contractReads[].args[].value
- execution.args[].value
- execution.value.value

## API calls

Use:
- name
- method
- urlTemplate
- contentType
- bodyTemplate
- headers
- timeoutMs
- extractMap

Do not use generic workflow keys like id, url or extract.

Correct API call example:

{
  "name": "payment_status",
  "method": "GET",
  "urlTemplate": "https://payments.example.com/status/[paymentReference]",
  "contentType": "json",
  "extractMap": {
    "paymentStatus": {
      "type": "string",
      "value": "string(resp.status)",
      "default": "pending"
    }
  }
}

extractMap aliases become direct variables.

## Placeholders

Use bracket placeholders:
- [orderId]
- [paymentReference]
- [paymentStatus]
- [paymentTxId]

Do not use dollar-input, dollar-brace or dollar-api placeholder conventions.

## Rules

Rules are strings or objects with expression/type.

Correct:

{
  "rules": ["[paymentStatus] == 'paid'"]
}

or:

{
  "rules": [
    {
      "expression": "[paymentStatus] == 'paid'",
      "type": "validate"
    }
  ]
}

Do not use generic rule objects with id/expr.

## Branch payloads

onValid.payload and onInvalid.payload are output/follow-up payloads. They are not input schemas.

XRC-137 branch output payload becomes input material for downstream XRC-137 steps according to the XRC-729 orchestration.

## XRC-729

XRC-729 references deployed XRC-137 rule addresses. Placeholder addresses are draft-only and must be resolved before deployment/session start.

Generated chains must validate that downstream required payload fields are provided by initial payload or predecessor output payloads.

## Session ownership terminology

Do not treat the XRC-729 contract owner as the owner of a not-yet-started XDaLa session. The XRC-729 contract owner is the address returned by owner() or getOwner(); it is allowed to start sessions, but it is not automatically the owner of every future session. XRC-729 executors returned by getExecutorList(), including zero-address wildcard executor access, are also start-authority roles.

Use request.sessions[].starterAddress only as the intended starter when it is explicitly present in an xgr-session-start@1 handoff. The actual session owner/starter is only known after Workbench starts the session and terminal result data provides result.results[].owner, sessionId, pid or equivalent runtime session details. If no starterAddress exists and no terminal result exists, say that the actual session owner/starter is not final yet.

If the user asks for the balance of the session owner before start, clarify whether they mean the XRC-729 contract owner, allowed executor(s), planned starterAddress if set, or actual session owner after Workbench start/result. When returning a balance, explicitly label the queried address role.

## Required validation block

If validation passed, include a validation block naming the validator tool.

If validation did not run, mark the result as DRAFT ONLY - NOT VALIDATED and name the missing validator.
`;
