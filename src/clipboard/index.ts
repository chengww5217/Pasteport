import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { describeError, type Logger } from '../log';
import { readDarwinClipboard } from './darwin';
import { readLinuxClipboard } from './linux';
import type { ClipboardContent } from './types';
import { readWin32Clipboard } from './win32';

export type { ClipboardContent } from './types';

/**
 * The name shape every platform reader must produce for a staged image:
 * `clipboard-<yyyymmdd>-<hhmmss>-<mmm>.png`.
 *
 * The TTL sweeper deletes only names matching this, so the contract between the
 * readers and the sweeper is stated here rather than duplicated at both ends.
 */
export const STAGED_IMAGE_PATTERN = /^clipboard-\d{8}-\d{6}-\d{3}\.png$/;

export interface ClipboardReader {
  read(): Promise<ClipboardContent>;
}

export interface ReaderContext {
  /** Root of the installed extension; resources/ lives directly under it. */
  extensionPath: string;
  /**
   * Where readers write images they extract from the clipboard.
   *
   * Supplied by the caller rather than derived from `os.tmpdir()`: on Linux that
   * is a shared, world-writable `/tmp`, where a fixed name can be pre-created or
   * pre-symlinked by another user and every staged screenshot would be readable
   * by all of them.
   */
  stagingDir: string;
  log: Logger;
}

/**
 * Returns the reader for the current client platform, or undefined where none
 * exists (Linux arrives with its own reader; see linux.ts).
 *
 * Undefined is a supported state, not an error: the caller falls through to the
 * built-in terminal paste, so on an unsupported platform the paste key keeps
 * behaving exactly as it did before the extension was installed.
 */
export function createClipboardReader(context: ReaderContext): ClipboardReader | undefined {
  const read = platformRead(context);
  if (read === undefined) return undefined;

  return {
    read: async (): Promise<ClipboardContent> => keepOnlyRegularFiles(await read(), context.log),
  };
}

/**
 * Readers ship as plain files under resources/ rather than being bundled: each
 * is handed to its interpreter by path, never required.
 */
function platformRead(context: ReaderContext): (() => Promise<ClipboardContent>) | undefined {
  const resource = (name: string): string => path.join(context.extensionPath, 'resources', name);
  const { stagingDir, log } = context;

  switch (process.platform) {
    case 'darwin':
      return () =>
        readDarwinClipboard({
          scriptPath: resource('clipboard-read.darwin.js'),
          stagingDir,
          log,
        });

    case 'win32':
      return () =>
        readWin32Clipboard({
          scriptPath: resource('clipboard-read.win32.ps1'),
          stagingDir,
          log,
        });

    // No resource file: the display server tools are the reader, so there is no
    // script to hand an interpreter.
    case 'linux':
      return () => readLinuxClipboard({ stagingDir, log });

    default:
      return undefined;
  }
}

/**
 * Drops anything that is not a plain readable file.
 *
 * Directories are the interesting case: a user copying a folder in Finder is
 * not asking for a recursive upload, and there is no sensible single path to
 * hand an agent, so the paste falls through to the terminal's own handling.
 */
export async function keepOnlyRegularFiles(
  content: ClipboardContent,
  log: Logger
): Promise<ClipboardContent> {
  if (content.kind !== 'files' && content.kind !== 'image') return content;

  const kept: string[] = [];
  for (const candidate of content.paths) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        kept.push(candidate);
      } else {
        log.debug(`skipping clipboard entry (not a regular file): ${candidate}`);
      }
    } catch (err) {
      log.debug(`skipping clipboard entry (${describeError(err)}): ${candidate}`);
    }
  }

  if (kept.length === 0) {
    // A staged image that vanished means the reader is broken; a folder copy is
    // ordinary user behaviour. Same outcome, different log level.
    if (content.kind === 'image') {
      return { kind: 'error', message: 'reader staged an image that is no longer readable' };
    }
    return { kind: 'other', types: ['file list (no regular files)'] };
  }

  return content.kind === 'files' ? { kind: 'files', paths: kept } : { kind: 'image', paths: kept };
}
