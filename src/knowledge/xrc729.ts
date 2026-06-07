export const xrc729Reference = `# XRC-729 Reference

XRC-729 is an on-chain orchestration registry for XDaLa processes.

Runtime model:
- A deployed XRC-729 contract stores OSTC JSON documents.
- OSTC means Orchestration Specification Text Canonical.
- The engine loads an OSTC via getOSTC(string ostcId).
- The session start provides the entry step id separately.
- The OSTC itself contains id and structure.
- structure is a map of stepId to step definition.
- Each step references one deployed XRC-137 rule contract in rule.
- While drafting, rule may be a placeholder such as {{XRC137_VALIDATE_INVOICE_ADDRESS}}.
- Before deployment or session start, every placeholder must be replaced by the deployed XRC-137 rule address.

Current OSTC branch format:
- onValid and onInvalid may contain spawns and/or join.
- spawns is an array of step id strings.
- join creates a join target and a scoped producer group.
- join.joinid is the target step id that will run after the join closes.
- join.from lists exact producer step ids that may satisfy the join.
- join.from[].when is valid, invalid or any. both is normalized to any by the engine.
- join.mode may be any, all, {kofn:N} or {k:N}.
- join.waitonjoin may be drain or kill. Empty defaults to drain.

Spawn guidance:
- Use plain spawns when the next step can run independently and no aggregation is required.
- Use spawns with join when multiple branches must feed one later step.
- If a branch has join, the engine creates the join target first, then creates producer spawns in a scoped group owned by that join target.
- Producer outputs are delivered only to open join targets in the same scope.

Join guidance:
- Use mode all when every listed producer must contribute.
- Use mode any when the first matching producer is enough.
- Use mode {kofn:N} when at least N of the listed producers are enough.
- Use when valid if only successful producer outputs should count.
- Use when invalid if failure branches should count.
- Use when any if either outcome should count.

Kill vs drain:
- drain is the safe default. After the join threshold is reached, already running producers may finish naturally.
- kill is for first-wins or k-of-n races where remaining waiting producers should be stopped once the join closes.
- Running producers are not force-killed; they finish, but spawn gates prevent additional producer work after a closed kill join.

Payload propagation:
- XRC-137 onValid/onInvalid payload output becomes the next payload piece for child steps.
- For plain spawns, the child receives the parent payload plus the XRC-137 output payload.
- For joins, each producer delivers its output payload to the join inbox.
- When the join closes, delivered producer payloads are merged into the join target input payload.
- If multiple producers write the same key, later merge order can overwrite earlier values; avoid ambiguous key collisions in agent-generated workflows.

Validation requirements for generated drafts:
- Every step id must be a valid ASCII identifier.
- Every spawn target should exist in structure.
- Every joinid should exist in structure.
- Every join.from[].node must exist in structure.
- Every join mode threshold must be in [1..number of join inputs].
- Every rule placeholder must eventually resolve to an XRC-137 address.
- XRC-137 output keys used by downstream rules must match the downstream payload schema.
`;

export const xrc729Schema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'structure'],
  properties: {
    id: { type: 'string' },
    structure: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['rule'],
        properties: {
          rule: { type: 'string' },
          onValid: { $ref: '#/$defs/branch' },
          onInvalid: { $ref: '#/$defs/branch' }
        }
      }
    }
  },
  $defs: {
    branch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        spawns: {
          type: 'array',
          items: { type: 'string' }
        },
        join: {
          type: 'object',
          additionalProperties: false,
          required: ['joinid'],
          properties: {
            joinid: { type: 'string' },
            mode: {
              anyOf: [
                { enum: ['any', 'all'] },
                {
                  type: 'object',
                  properties: {
                    kofn: { type: 'integer' },
                    k: { type: 'integer' }
                  },
                  additionalProperties: false
                }
              ]
            },
            waitonjoin: { enum: ['drain', 'kill'] },
            from: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['node'],
                properties: {
                  node: { type: 'string' },
                  when: { enum: ['valid', 'invalid', 'any', 'both'] }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

export const xrc729Examples = {
  simpleLinearProcess: {
    id: 'invoice_linear_v1',
    structure: {
      validate_invoice: {
        rule: '{{XRC137_VALIDATE_INVOICE_ADDRESS}}',
        onValid: {
          spawns: ['check_supplier']
        }
      },
      check_supplier: {
        rule: '{{XRC137_CHECK_SUPPLIER_ADDRESS}}',
        onValid: {
          spawns: ['execute_approval']
        }
      },
      execute_approval: {
        rule: '{{XRC137_EXECUTE_APPROVAL_ADDRESS}}'
      }
    }
  },
  parallelAllJoinDrain: {
    id: 'parallel_all_join_v1',
    structure: {
      start_checks: {
        rule: '{{XRC137_START_ADDRESS}}',
        onValid: {
          spawns: ['kyc_check', 'risk_check'],
          join: {
            joinid: 'final_approval',
            mode: 'all',
            waitonjoin: 'drain',
            from: [
              { node: 'kyc_check', when: 'valid' },
              { node: 'risk_check', when: 'valid' }
            ]
          }
        }
      },
      kyc_check: {
        rule: '{{XRC137_KYC_CHECK_ADDRESS}}'
      },
      risk_check: {
        rule: '{{XRC137_RISK_CHECK_ADDRESS}}'
      },
      final_approval: {
        rule: '{{XRC137_FINAL_APPROVAL_ADDRESS}}'
      }
    }
  },
  twoOfThreeJoinKill: {
    id: 'two_of_three_join_v1',
    structure: {
      start_checks: {
        rule: '{{XRC137_START_ADDRESS}}',
        onValid: {
          spawns: ['provider_a', 'provider_b', 'provider_c'],
          join: {
            joinid: 'aggregate_result',
            mode: { kofn: 2 },
            waitonjoin: 'kill',
            from: [
              { node: 'provider_a', when: 'valid' },
              { node: 'provider_b', when: 'valid' },
              { node: 'provider_c', when: 'valid' }
            ]
          }
        }
      },
      provider_a: { rule: '{{XRC137_PROVIDER_A_ADDRESS}}' },
      provider_b: { rule: '{{XRC137_PROVIDER_B_ADDRESS}}' },
      provider_c: { rule: '{{XRC137_PROVIDER_C_ADDRESS}}' },
      aggregate_result: { rule: '{{XRC137_AGGREGATE_RESULT_ADDRESS}}' }
    }
  }
} as const;
