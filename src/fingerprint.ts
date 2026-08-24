import * as crypto from 'node:crypto';

/**
 * Deduplication keys.
 *
 * A fingerprint names the remote directory a payload lands in, so two pastes
 * of the same bytes resolve to the same remote path and the second one costs
 * no transfer at all.
 *
 * Two tiers, because the two failure modes pull in opposite directions:
 *  - content hash is exact but reads the whole file;
 *  - metadata hash is instant but can alias (same size + mtime + name,
 *    different bytes) which would make an agent silently read a stale file.
 *
 * Small files are both the common case and cheap to hash, so they get the
 * exact key; only payloads large enough for hashing to be noticeable fall back
 * to metadata.
 */

/** Above this size, hashing the bytes costs more than the risk it removes. */
export const CONTENT_HASH_LIMIT_BYTES = 8 * 1024 * 1024;

/** 64 bits of hex: short enough to keep remote paths readable. */
const DIGEST_CHARS = 16;

function sha256(input: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, DIGEST_CHARS);
}

export function shouldHashContent(sizeBytes: number): boolean {
  return sizeBytes <= CONTENT_HASH_LIMIT_BYTES;
}

export function contentFingerprint(bytes: Uint8Array): string {
  return sha256(bytes);
}

export interface FileMetadata {
  size: number;
  /** Modification time in milliseconds; truncated to whole ms for stability. */
  mtimeMs: number;
  /** File name only — a moved file keeps its identity, a renamed one does not. */
  name: string;
}

export function metadataFingerprint(meta: FileMetadata): string {
  return sha256(`${meta.size}:${Math.floor(meta.mtimeMs)}:${meta.name}`);
}
