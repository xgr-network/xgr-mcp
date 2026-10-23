import { createHash } from 'node:crypto';
import { CommonsError } from './store.js';

export const MAX_COMMONS_ATTACHMENT_BYTES = 1024 * 1024;
export type CommonsAttachmentInput = { filename: string; mimeType?: string; base64: string };
export type DecodedCommonsAttachment = { filename: string; mimeType: string; bytes: Buffer; sha256: string };

export function decodeCommonsAttachment(input?: CommonsAttachmentInput): DecodedCommonsAttachment | null {
  if (input === undefined) return null;
  if (!input || typeof input !== 'object' || typeof input.filename !== 'string' || typeof input.base64 !== 'string')
    throw new CommonsError('Attachment must include filename and base64 content.');
  const filename = input.filename.replace(/[\\/\x00-\x1f\x7f]/g, '_').trim();
  if (!filename || filename.length > 120 || filename === '.' || filename === '..')
    throw new CommonsError('Attachment filename must have 1-120 characters.');
  const type = typeof input.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType)
    ? input.mimeType.slice(0, 100) : 'application/octet-stream';
  const encoded = input.base64;
  if (!encoded || encoded.length > 4 * Math.ceil(MAX_COMMONS_ATTACHMENT_BYTES / 3) + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new CommonsError('Invalid attachment encoding or file exceeds 1 MiB.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_COMMONS_ATTACHMENT_BYTES)
    throw new CommonsError('Attachment must contain 1 byte to 1 MiB.');
  return { filename, mimeType: type, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function attachmentInfo(filename: string | null, mimeType: string | null, bytes: Buffer | null, sha256: string | null) {
  if (!filename || !bytes) return null;
  return { filename, mimeType: mimeType || 'application/octet-stream', sizeBytes: bytes.length, sha256 };
}

export function attachmentDownloadHeader(filename: string): string {
  const fallback = filename.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100) || 'attachment';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
