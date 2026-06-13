export { xrc137Reference } from './docs.js';

export const xrc137Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['payload', 'rules', 'onValid', 'onInvalid'],
  properties: {
    payload: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['type'],
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          default: {}
        }
      }
    },
    apiCalls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'method', 'urlTemplate', 'contentType'],
        properties: {
          name: { type: 'string' },
          method: { type: 'string' },
          urlTemplate: { type: 'string' },
          contentType: { type: 'string' },
          bodyTemplate: { type: 'string' },
          headers: { type: 'object' },
          timeoutMs: { type: 'integer' },
          extractMap: { type: 'object' }
        }
      }
    },
    contractReads: {
      type: 'array',
      items: {
        type: 'object',
        required: ['to', 'function'],
        properties: {
          to: { type: 'string' },
          function: { type: 'string' },
          args: { type: 'array' },
          saveAs: { type: 'object' },
          rpc: { type: 'string' }
        }
      }
    },
    rules: {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            required: ['expression'],
            properties: {
              expression: { type: 'string' },
              type: { enum: ['validate', 'abortStep', 'cancelSession'] }
            }
          }
        ]
      }
    },
    onValid: { $ref: '#/$defs/branch' },
    onInvalid: { $ref: '#/$defs/branch' }
  },
  $defs: {
    typedValue: {
      type: 'object',
      required: ['type', 'value'],
      properties: {
        type: { type: 'string' },
        value: {},
        default: {}
      }
    },
    branch: {
      type: 'object',
      properties: {
        waitSec: {},
        payload: { type: 'object' },
        encryptLogs: { type: 'boolean' },
        logExpireDays: { type: 'integer' },
        grants: { type: 'array' },
        wakeUps: { type: 'array' },
        execution: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            function: { type: 'string' },
            args: { type: 'array' },
            gas: { type: 'object' },
            value: { $ref: '#/$defs/typedValue' },
            extras: { type: 'object' }
          }
        }
      }
    }
  }
} as const;

export const xrc137Examples = {
  simpleValidation: {
    payload: {
      amount: { type: 'uint256' },
      recipient: { type: 'address' },
      invoiceId: { type: 'string' }
    },
    rules: [
      { expression: 'uint256([amount]) > 0', type: 'validate' },
      { expression: 'address([recipient]) != address(0)', type: 'validate' }
    ],
    onValid: {
      payload: {
        status: 'approved',
        invoiceId: '[invoiceId]'
      },
      encryptLogs: true,
      logExpireDays: 365
    },
    onInvalid: {
      payload: {
        status: 'rejected',
        invoiceId: '[invoiceId]'
      },
      encryptLogs: true,
      logExpireDays: 30
    }
  },
  apiCheck: {
    payload: {
      vatId: { type: 'string' }
    },
    apiCalls: [
      {
        name: 'vat_check',
        method: 'GET',
        urlTemplate: 'https://example.invalid/vat/[vatId]',
        contentType: 'json',
        timeoutMs: 5000,
        extractMap: {
          vatValid: { type: 'bool', value: 'resp.valid', default: false, save: true }
        }
      }
    ],
    rules: [{ expression: '[vatValid] == true', type: 'validate' }],
    onValid: { payload: { status: 'valid_vat' }, encryptLogs: true, logExpireDays: 365 },
    onInvalid: { payload: { status: 'invalid_vat' }, encryptLogs: true, logExpireDays: 30 }
  },
  literalOutput: {
    payload: {},
    rules: ['true'],
    onValid: {
      payload: {
        result: 1
      }
    },
    onInvalid: {
      payload: {
        error: 'not_completed'
      }
    }
  }
} as const;
