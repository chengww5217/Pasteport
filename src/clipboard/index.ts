import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describeError, type Logger } from '../log';
import { readDarwinClipboard } from './darwin';
import type { ClipboardContent } from './types';

export type { ClipboardContent } from './types';

/** Where platform readers stage images they extract from the clipboard. */
export const STAGING_DIR = path.join(os.tmpdir(), 'pasteport-staging');

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
  /** Root of the installed extension; media/ lives directly under it. */
  extensionPath: string;
  log: Logger;
}

/**
 * Returns the reader for the current client platform, or undefined where none
 * exists yet (Windows: M3, Linux: M4).
 *
 * Undefined is a supported state, not an error: the caller falls through to the
 * built-in terminal paste, so on an unsupported platform Cmd+V keeps behaving
 * exactly as it did before the extension was installed.
 */
export function createClipboardReader(context: ReaderContext): ClipboardReader | undefined {
  if (process.platform !== 'darwin') return undefined;

  const scriptPath = path.join(context.extensionPath, 'media', 'clipboard-read.js');
  return {
    read: async (): Promise<ClipboardContent> => {
      const content = await readDarwinClipboard({
        scriptPath,
        stagingDir: STAGING_DIR,
        log: context.log,
      });
      return keepOnlyRegularFiles(content, context.log);
    },
  };
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
    return { kind: 'other', types: ['public.file-url (no regular files)'] };
  }

  return content.kind === 'files' ? { kind: 'files', paths: kept } : { kind: 'image', paths: kept };
}
