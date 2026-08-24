import type { Logger } from '../log';
import { runJsonReader } from './host';
import type { ClipboardContent } from './types';

/**
 * Generous relative to the measured ~30ms: a very large TIFF still has to be
 * decoded and re-encoded. The point of the timeout is to never wedge Cmd+V,
 * not to enforce a latency budget.
 */
const READ_TIMEOUT_MS = 10_000;

/** Measured steady state is ~30ms, so anything near 150ms is a regression. */
const SLOW_WARN_MS = 150;

export interface DarwinReaderOptions {
  /** Absolute path to resources/clipboard-read.darwin.js. */
  scriptPath: string;
  /** Directory the reader writes staged images into; created if absent. */
  stagingDir: string;
  log: Logger;
}

/**
 * Runs the JXA reader.
 *
 * osascript is spawned per read rather than kept resident: 30ms is well inside
 * the perceptual budget, and a resident helper would add lifecycle bugs to the
 * path that every Cmd+V goes through.
 */
export function readDarwinClipboard(options: DarwinReaderOptions): Promise<ClipboardContent> {
  return runJsonReader({
    command: '/usr/bin/osascript',
    args: ['-l', 'JavaScript', options.scriptPath, options.stagingDir],
    stagingDir: options.stagingDir,
    label: 'osascript',
    timeoutMs: READ_TIMEOUT_MS,
    slowWarnMs: SLOW_WARN_MS,
    log: options.log,
  });
}
