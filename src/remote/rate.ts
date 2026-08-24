/**
 * Throughput estimate used to decide how a transfer is presented.
 *
 * Every threshold in the UI is expressed in seconds rather than bytes, because
 * measured throughput varies by more than an order of magnitude across links
 * (3.5 MB/s over the gateway this was developed against, far more on a LAN,
 * under 1 MB/s over a VPN). A byte count is a poor proxy for "will this feel
 * slow"; an estimated duration is the thing the user actually cares about.
 *
 * Pure module — no vscode, no I/O. Persistence is the caller's business.
 */

/** Conservative starting point for the very first transfer of a fresh install. */
export const INITIAL_RATE_BYTES_PER_SEC = 5 * 1024 * 1024;

/** Weight of the newest sample. High enough to react to a link change quickly. */
export const EWMA_ALPHA = 0.3;

/**
 * Samples smaller than this are dominated by round-trip latency, not bandwidth
 * (a 256-byte write took 76ms in testing — 3 KB/s, which says nothing about the
 * link). Feeding them in would drag the estimate toward zero and make every
 * paste look slow enough to need a confirmation dialog.
 */
export const MIN_SAMPLE_BYTES = 256 * 1024;

export class RateEstimator {
  private rate: number;

  constructor(initialBytesPerSecond: number = INITIAL_RATE_BYTES_PER_SEC) {
    this.rate = sanitize(initialBytesPerSecond) ?? INITIAL_RATE_BYTES_PER_SEC;
  }

  get bytesPerSecond(): number {
    return this.rate;
  }

  /** Estimated wall-clock seconds to move `bytes` at the current estimate. */
  estimateSeconds(bytes: number): number {
    if (bytes <= 0) return 0;
    return bytes / this.rate;
  }

  /**
   * Folds one completed transfer into the estimate.
   *
   * @returns true when the sample was large enough to be informative.
   */
  observe(bytes: number, elapsedMs: number): boolean {
    if (bytes < MIN_SAMPLE_BYTES || elapsedMs <= 0) return false;

    const sample = sanitize(bytes / (elapsedMs / 1000));
    if (sample === undefined) return false;

    this.rate = EWMA_ALPHA * sample + (1 - EWMA_ALPHA) * this.rate;
    return true;
  }
}

function sanitize(rate: number | undefined): number | undefined {
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) return undefined;
  return rate;
}
