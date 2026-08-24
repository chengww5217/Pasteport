import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatBytes, formatSeconds } from '../format';

test('formatBytes switches unit at each 1024 boundary', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1024 * 1024 - 1), '1024 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(8 * 1024 * 1024), '8.0 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.00 GB');
});

test('formatSeconds stays coarse, and admits when it does not know', () => {
  assert.equal(formatSeconds(0), '<1s');
  assert.equal(formatSeconds(0.4), '<1s');
  assert.equal(formatSeconds(1), '1s');
  assert.equal(formatSeconds(28.4), '28s');
  assert.equal(formatSeconds(60), '1m');
  assert.equal(formatSeconds(95), '1m 35s');
  assert.equal(formatSeconds(Number.POSITIVE_INFINITY), 'unknown');
  assert.equal(formatSeconds(-1), 'unknown');
});
