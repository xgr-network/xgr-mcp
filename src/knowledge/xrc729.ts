export { xrc729Reference } from './docs.js';

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
