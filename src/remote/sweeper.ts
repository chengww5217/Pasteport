import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { describeError, type Logger } from '../log';
import { normalizeRemoteDir } from './paths';
import { remoteUri } from './target';

/**
 * Age-based cleanup for both ends.
 *
 * Runs on activation and from a command; never blocks a paste. Deletion is
 * restricted to entries this extension is certain it created, because
 * `pasteport.remoteDir` is user-configurable and pointing it at `/tmp` must not
 * turn a TTL sweep into a general-purpose `/tmp` cleaner.
 */

/** Fingerprint directories, the only thing we create under remoteDir. */
const FINGERPRINT_DIR = /^[0-9a-f]{16}$/;

/** Staged image names, the only thing the readers create under stagingDir. */
const STAGED_FILE = /^clipboard-\d{8}-\d{6}-\d{3}\.png$/;

export interface SweepResult {
  removed: number;
  kept: number;
  /** Entries left alone because they were not ours to delete. */
  foreign: number;
}

const EMPTY: SweepResult = { removed: 0, kept: 0, foreign: 0 };

export async function sweepRemote(options: {
  template: vscode.Uri;
  remoteDir: string;
  ttlHours: number;
  log: Logger;
}): Promise<SweepResult> {
  const { template, ttlHours, log } = options;
  if (ttlHours <= 0) {
    log.debug('remote sweep disabled (ttlHours <= 0)');
    return EMPTY;
  }

  let root: vscode.Uri;
  try {
    root = remoteUri(template, normalizeRemoteDir(options.remoteDir));
  } catch (err) {
    log.warn(`remote sweep skipped: ${describeError(err)}`);
    return EMPTY;
  }

  let entries: Array<[string, vscode.FileType]>;
  try {
    entries = await vscode.workspace.fs.readDirectory(root);
  } catch (err) {
    // Nothing pasted yet on this host is the common case, not a problem.
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') return EMPTY;
    log.warn(`remote sweep could not list ${root.path}: ${describeError(err)}`);
    return EMPTY;
  }

  const cutoff = Date.now() - ttlHours * 3600_000;
  const result: SweepResult = { removed: 0, kept: 0, foreign: 0 };

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory || !FINGERPRINT_DIR.test(name)) {
      result.foreign += 1;
      log.trace(`remote sweep leaving foreign entry alone: ${name}`);
      continue;
    }

    const dir = remoteUri(template, `${root.path}/${name}`);
    try {
      const stat = await vscode.workspace.fs.stat(dir);
      if (stat.mtime > cutoff) {
        result.kept += 1;
        continue;
      }
      await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
      result.removed += 1;
    } catch (err) {
      log.debug(`remote sweep skipped ${name}: ${describeError(err)}`);
    }
  }

  log.info(
    `remote sweep of ${root.path}: removed ${result.removed}, kept ${result.kept}, ` +
      `left ${result.foreign} foreign entr${result.foreign === 1 ? 'y' : 'ies'} alone`
  );
  return result;
}

/**
 * Same policy for the local staging directory.
 *
 * Uses the async fs API: this runs in the extension host, and a synchronous
 * directory walk there stalls the whole UI extension.
 */
export async function sweepStaging(options: {
  stagingDir: string;
  ttlHours: number;
  log: Logger;
}): Promise<SweepResult> {
  const { stagingDir, ttlHours, log } = options;
  if (ttlHours <= 0) return EMPTY;

  let names: string[];
  try {
    names = await fs.readdir(stagingDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.warn(`staging sweep could not list ${stagingDir}: ${describeError(err)}`);
    }
    return EMPTY;
  }

  const cutoff = Date.now() - ttlHours * 3600_000;
  const result: SweepResult = { removed: 0, kept: 0, foreign: 0 };

  for (const name of names) {
    if (!STAGED_FILE.test(name)) {
      result.foreign += 1;
      continue;
    }

    const file = path.join(stagingDir, name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) {
        result.foreign += 1;
        continue;
      }
      if (stat.mtimeMs > cutoff) {
        result.kept += 1;
        continue;
      }
      await fs.rm(file, { force: true });
      result.removed += 1;
    } catch (err) {
      log.debug(`staging sweep skipped ${name}: ${describeError(err)}`);
    }
  }

  log.info(`staging sweep of ${stagingDir}: removed ${result.removed}, kept ${result.kept}`);
  return result;
}
