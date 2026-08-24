import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';

import { describeError, type Logger } from '../log';
import { parseClipboardPayload, type ClipboardContent } from './types';

const execFileAsync = promisify(execFile);

/**
 * Generous relative to the measured ~30ms: a very large TIFF still has to be
 * decoded and re-encoded. The point of the timeout is to never wedge Cmd+V,
 * not to enforce a latency budget.
 */
const READ_TIMEOUT_MS = 10_000;

/** Only paths and type names come back over stdout, never image bytes. */
const MAX_STDOUT_BYTES = 1024 * 1024;

export interface DarwinReaderOptions {
  /** Absolute path to media/clipboard-read.js. */
  scriptPath: string;
  /** Directory the reader writes staged images into; created if absent. */
  stagingDir: string;
  log: Logger;
}

/**
 * Runs the JXA reader and parses its single JSON line.
 *
 * osascript is spawned per read rather than kept resident: 30ms is well inside
 * the perceptual budget, and a resident helper would add lifecycle bugs to the
 * path that every Cmd+V goes through.
 */
export async function readDarwinClipboard(options: DarwinReaderOptions): Promise<ClipboardContent> {
  const { scriptPath, stagingDir, log } = options;

  try {
    await fs.mkdir(stagingDir, { recursive: true });
  } catch (err) {
    return {
      kind: 'error',
      message: `cannot create staging directory ${stagingDir}: ${describeError(err)}`,
    };
  }

  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', scriptPath, stagingDir],
      { timeout: READ_TIMEOUT_MS, maxBuffer: MAX_STDOUT_BYTES, encoding: 'utf8' }
    );

    // osascript prints its own diagnostics here; they are not failures.
    if (stderr.trim() !== '') log.debug(`clipboard reader stderr: ${stderr.trim()}`);
    log.trace(`clipboard read in ${Date.now() - started}ms`);

    return parseClipboardPayload(stdout);
  } catch (err) {
    return {
      kind: 'error',
      message: `clipboard reader failed after ${Date.now() - started}ms: ${describeError(err)}`,
    };
  }
}
