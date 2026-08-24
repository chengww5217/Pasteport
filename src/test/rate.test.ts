import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EWMA_ALPHA,
  INITIAL_RATE_BYTES_PER_SEC,
  MIN_SAMPLE_BYTES,
  RateEstimator,
} from '../remote/rate';

test('a fresh estimator starts at the conservative built-in rate', () => {
  const estimator = new RateEstimator();
  assert.equal(estimator.bytesPerSecond, INITIAL_RATE_BYTES_PER_SEC);
  assert.equal(estimator.estimateSeconds(INITIAL_RATE_BYTES_PER_SEC), 1);
  assert.equal(estimator.estimateSeconds(0), 0);
  assert.equal(estimator.estimateSeconds(-1), 0);
});

test('a persisted rate is restored, nonsense values are not', () => {
  assert.equal(new RateEstimator(1024).bytesPerSecond, 1024);

  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(
      new RateEstimator(bad as number).bytesPerSecond,
      INITIAL_RATE_BYTES_PER_SEC,
      `bad=${String(bad)}`
    );
  }
});

test('samples below the minimum size are ignored', () => {
  const estimator = new RateEstimator();
  // 256 bytes in 76ms is ~3 KB/s: round-trip latency, not bandwidth.
  assert.equal(estimator.observe(256, 76), false);
  assert.equal(estimator.bytesPerSecond, INITIAL_RATE_BYTES_PER_SEC);

  assert.equal(estimator.observe(MIN_SAMPLE_BYTES, 0), false);
  assert.equal(estimator.bytesPerSecond, INITIAL_RATE_BYTES_PER_SEC);
});

test('a large sample is folded in with the documented weight', () => {
  const estimator = new RateEstimator(INITIAL_RATE_BYTES_PER_SEC);
  const bytes = 8 * 1024 * 1024;
  const elapsedMs = 2315; // measured 8 MB write over the gateway
  const sample = bytes / (elapsedMs / 1000);

  assert.equal(estimator.observe(bytes, elapsedMs), true);
  assert.equal(
    estimator.bytesPerSecond,
    EWMA_ALPHA * sample + (1 - EWMA_ALPHA) * INITIAL_RATE_BYTES_PER_SEC
  );
});

test('repeated samples converge toward the observed rate', () => {
  const estimator = new RateEstimator();
  const bytes = 4 * 1024 * 1024;
  const observedRate = 1024 * 1024; // 1 MB/s link

  for (let i = 0; i < 25; i++) estimator.observe(bytes, (bytes / observedRate) * 1000);

  assert.ok(Math.abs(estimator.bytesPerSecond - observedRate) < observedRate * 0.01);
  // 100 MB on such a link is ~100s, which must clear a 5s confirmation threshold.
  assert.ok(estimator.estimateSeconds(100 * 1024 * 1024) > 5);
});
