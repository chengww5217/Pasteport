import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';

import { describeError, type Logger } from '../log';
import { parseClipboardPayload, type ClipboardContent } from './types';

const execFileAsync = promisify(execFile);

/**
 * Only paths and type names come back over stdout, never image bytes.
 *
 * Generous rather than tight: a selection of a few thousand files is unusual but
 * legitimate, and exceeding this kills the reader with ENOBUFS, which surfaces
 * as a pass-through the user cannot explain.
 */
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

/**
 * Runs one of the platform reader programs and parses its JSON line.
 *
 * The readers themselves share no code — JXA and PowerShell have nothing in
 * common — but spawning one, timing it, and turning failures into an error
 * payload is identical work, so it lives here rather than twice.
 */
export interface JsonReaderOptions {
  /** Absolute path to the interpreter; never resolved through PATH. */
  command: string;
  args: string[];
  /** Created before the reader runs, since readers stage images into it. */
  stagingDir: string;
  /** Short name used in log lines. */
  label: string;
  /** Hard limit, only there to keep a wedged interpreter from wedging a paste. */
  timeoutMs: number;
  /**
   * Above this, one warning is logged: a clipboard probe runs on every paste,
   * including plain-text ones, so its cost is felt as input latency.
   */
  slowWarnMs: number;
  log: Logger;
}

const slowWarningIssued = new Set<string>();

export async function runJsonReader(options: JsonReaderOptions): Promise<ClipboardContent> {
  const { command, args, stagingDir, label, log } = options;

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
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeoutMs,
      maxBuffer: MAX_STDOUT_BYTES,
      encoding: 'utf8',
      windowsHide: true,
    });

    const elapsed = Date.now() - started;

    // Interpreters print their own diagnostics here; they are not failures.
    if (stderr.trim() !== '') log.debug(`${label} stderr: ${stderr.trim()}`);
    log.trace(`clipboard read via ${label} in ${elapsed}ms`);

    if (elapsed > options.slowWarnMs && !slowWarningIssued.has(label)) {
      slowWarningIssued.add(label);
      log.warn(
        `clipboard probe via ${label} took ${elapsed}ms (over ${options.slowWarnMs}ms). ` +
          'This cost is paid on every paste, including plain text ones. ' +
          'If it stays this high, the reader should move to a resident process.'
      );
    }

    return parseClipboardPayload(stdout);
  } catch (err) {
    return {
      kind: 'error',
      message: `${label} reader failed after ${Date.now() - started}ms: ${describeError(err)}`,
    };
  }
}
