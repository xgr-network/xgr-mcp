import { rpcCall } from './rpcClient.js';

const WORD_HEX_LENGTH = 64;
const XRC729_GET_OSTC_SELECTOR = '9335a4d1'; // getOSTC(string)
const XRC729_GET_ALL_OSTC_SELECTOR = 'ff283c24'; // getAllOSTC()
const XRC137_GET_RULE_SELECTOR = 'b78ba7c8'; // getRule()

function strip0x(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function assertHex(value: string, label: string): void {
  if (!/^[0-9a-fA-F]*$/.test(strip0x(value))) throw new Error(`${label} is not valid hex data.`);
}

function encodeUint256(value: bigint): string {
  if (value < 0n) throw new Error('Cannot ABI-encode negative uint256 values.');
  return value.toString(16).padStart(WORD_HEX_LENGTH, '0');
}

function rightPadWord(hex: string): string {
  const remainder = hex.length % WORD_HEX_LENGTH;
  return remainder === 0 ? hex : hex.padEnd(hex.length + WORD_HEX_LENGTH - remainder, '0');
}

function readWord(hex: string, offsetBytes: number): string {
  const start = offsetBytes * 2;
  const end = start + WORD_HEX_LENGTH;
  if (end > hex.length) throw new Error('ABI return data is shorter than expected.');
  return hex.slice(start, end);
}

function readUint256(hex: string, offsetBytes: number): bigint {
  return BigInt(`0x${readWord(hex, offsetBytes)}`);
}

export function encodeAbiStringCall(selector: string, value?: string): `0x${string}` {
  assertHex(selector, 'Function selector');
  const normalizedSelector = strip0x(selector);
  if (normalizedSelector.length !== 8) throw new Error('Function selector must be exactly 4 bytes.');
  if (value === undefined) return `0x${normalizedSelector}`;
  const encoded = Buffer.from(value, 'utf8').toString('hex');
  return `0x${normalizedSelector}${encodeUint256(32n)}${encodeUint256(BigInt(encoded.length / 2))}${rightPadWord(encoded)}`;
}

function decodeStringAt(hex: string, offsetBytes: number): string {
  const length = Number(readUint256(hex, offsetBytes));
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('ABI string length is invalid.');
  const dataStart = (offsetBytes + 32) * 2;
  const dataEnd = dataStart + length * 2;
  if (dataEnd > hex.length) throw new Error('ABI string payload is truncated.');
  return Buffer.from(hex.slice(dataStart, dataEnd), 'hex').toString('utf8');
}

export function decodeAbiStringReturn(data: string): string {
  assertHex(data, 'eth_call result');
  const hex = strip0x(data);
  if (hex.length === 0) throw new Error('Contract call returned empty data.');
  if (hex.length < WORD_HEX_LENGTH * 2) throw new Error('Contract call did not return an ABI-encoded string.');
  const offset = Number(readUint256(hex, 0));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('ABI string offset is invalid.');
  return decodeStringAt(hex, offset);
}

export function decodeAbiStringArrayReturn(data: string): string[] {
  assertHex(data, 'eth_call result');
  const hex = strip0x(data);
  if (hex.length === 0) throw new Error('Contract call returned empty data.');
  if (hex.length < WORD_HEX_LENGTH * 2) throw new Error('Contract call did not return an ABI-encoded string array.');
  const arrayOffset = Number(readUint256(hex, 0));
  if (!Number.isSafeInteger(arrayOffset) || arrayOffset < 0) throw new Error('ABI string array offset is invalid.');
  const length = Number(readUint256(hex, arrayOffset));
  if (!Number.isSafeInteger(length) || length < 0 || length > 10000) throw new Error('ABI string array length is invalid.');
  const values: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const relativeOffset = Number(readUint256(hex, arrayOffset + 32 + i * 32));
    if (!Number.isSafeInteger(relativeOffset) || relativeOffset < 0) throw new Error('ABI string array element offset is invalid.');
    values.push(decodeStringAt(hex, arrayOffset + 32 + relativeOffset));
  }
  return values;
}

async function readContractString(address: string, data: `0x${string}`): Promise<string> {
  const result = await rpcCall<string>('eth_call', [{ to: address, data }, 'latest']);
  return decodeAbiStringReturn(result);
}

async function readContractStringArray(address: string, data: `0x${string}`): Promise<string[]> {
  const result = await rpcCall<string>('eth_call', [{ to: address, data }, 'latest']);
  return decodeAbiStringArrayReturn(result);
}

export async function readXrc729OstcIds(address: string): Promise<string[]> {
  return readContractStringArray(address, encodeAbiStringCall(XRC729_GET_ALL_OSTC_SELECTOR));
}

export async function readXrc729OstcJson(address: string, ostcId: string): Promise<string> {
  return readContractString(address, encodeAbiStringCall(XRC729_GET_OSTC_SELECTOR, ostcId));
}

export async function readXrc137RuleJson(address: string): Promise<string> {
  return readContractString(address, encodeAbiStringCall(XRC137_GET_RULE_SELECTOR));
}
