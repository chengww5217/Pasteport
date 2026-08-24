import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { test } from 'node:test';

import {
  CONTENT_HASH_LIMIT_BYTES,
  contentFingerprint,
  metadataFingerprint,
  shouldHashContent,
} from '../fingerprint';

test('contentFingerprint is the sha256 prefix and is stable', () => {
  const bytes = Buffer.from('pasteport');
  const expected = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);

  assert.equal(contentFingerprint(bytes), expected);
  assert.equal(contentFingerprint(bytes), contentFingerprint(Buffer.from('pasteport')));
  assert.match(contentFingerprint(bytes), /^[0-9a-f]{16}$/);
});

test('contentFingerprint separates payloads that differ by one bit', () => {
  const a = Buffer.from([0x00, 0x80, 0xff]);
  const b = Buffer.from([0x00, 0x81, 0xff]);
  assert.notEqual(contentFingerprint(a), contentFingerprint(b));
});

test('contentFingerprint is binary safe across all byte values', () => {
  const all = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  assert.equal(contentFingerprint(all), contentFingerprint(Buffer.from(all)));
});

test('metadataFingerprint keys on size, mtime and name', () => {
  const base = { size: 1024, mtimeMs: 1_700_000_000_000, name: 'clip.png' };

  assert.equal(metadataFingerprint(base), metadataFingerprint({ ...base }));
  assert.notEqual(metadataFingerprint(base), metadataFingerprint({ ...base, size: 1025 }));
  assert.notEqual(
    metadataFingerprint(base),
    metadataFingerprint({ ...base, mtimeMs: base.mtimeMs + 1 })
  );
  assert.notEqual(metadataFingerprint(base), metadataFingerprint({ ...base, name: 'clip2.png' }));
});

test('metadataFingerprint ignores sub-millisecond mtime jitter', () => {
  // Remote and local stat report mtime at different precisions; only whole
  // milliseconds are dependable, so they must not change the key.
  const base = { size: 10, mtimeMs: 1_700_000_000_000, name: 'a' };
  assert.equal(
    metadataFingerprint(base),
    metadataFingerprint({ ...base, mtimeMs: base.mtimeMs + 0.4 })
  );
});

test('shouldHashContent switches tiers at the 8 MB boundary', () => {
  assert.equal(shouldHashContent(0), true);
  assert.equal(shouldHashContent(CONTENT_HASH_LIMIT_BYTES), true);
  assert.equal(shouldHashContent(CONTENT_HASH_LIMIT_BYTES + 1), false);
});
