import * as path from 'node:path';

import type { Logger } from '../log';
import { runJsonReader } from './host';
import type { ClipboardContent } from './types';

/**
 * PowerShell starts far more slowly than osascript, and a cold start on a busy
 * machine can take seconds. The timeout is correspondingly generous: its only
 * job is to stop a wedged interpreter from wedging the keystroke.
 */
const READ_TIMEOUT_MS = 15_000;

/**
 * The threshold from the design's R6: above this the per-keystroke cost is
 * noticeable and the reader needs to become a resident process. It is a
 * warning, not a failure — the paste still works, it just feels slow.
 */
const SLOW_WARN_MS = 150;

export interface Win32ReaderOptions {
  /** Absolute path to resources/clipboard-read.win32.ps1. */
  scriptPath: string;
  stagingDir: string;
  log: Logger;
}

/**
 * Windows PowerShell rather than `pwsh`: 5.1 ships with every supported
 * Windows, PowerShell 7 does not. Resolved from `SystemRoot` rather than PATH so
 * a directory earlier in PATH cannot substitute its own powershell.exe.
 *
 * Joined with `path.win32` explicitly: the result is a Windows path whether or
 * not the host running this code is Windows, which also lets it be tested from
 * any platform.
 */
export function powershellPath(): string {
  const root = process.env['SystemRoot'] ?? 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function readWin32Clipboard(options: Win32ReaderOptions): Promise<ClipboardContent> {
  return runJsonReader({
    command: powershellPath(),
    args: [
      '-NoProfile', // skip profile scripts; they can print and cost time
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass', // the default policy blocks running a .ps1 from disk
      '-STA', // the clipboard API returns nothing from an MTA thread
      '-File',
      options.scriptPath,
      options.stagingDir,
    ],
    stagingDir: options.stagingDir,
    label: 'powershell',
    timeoutMs: READ_TIMEOUT_MS,
    slowWarnMs: SLOW_WARN_MS,
    log: options.log,
  });
}
