import * as vscode from 'vscode';

import { describeError, type Logger } from '../log';
import { remoteUri } from './target';
import {
  detectRemoteTempRoot,
  FALLBACK_REMOTE_TMP,
  remoteDirUnder,
  type RemoteProbe,
} from './tempDir';

/**
 * Turns the `pasteport.remoteDir` setting into an actual directory.
 *
 * An explicit setting is used verbatim; an empty one means "ask the host", which
 * costs one or two round trips. Only an answer the host actually gave is
 * remembered — see resolve() — and only until the window is reloaded.
 */

/**
 * Detection has to be bounded, because a paste is waiting on it.
 *
 * A half-dead SSH connection leaves `workspace.fs` calls pending indefinitely;
 * without this the paste command would never return, and the guard that stops
 * two pastes overlapping would stay closed for the rest of the session.
 */
const DETECT_TIMEOUT_MS = 5_000;

interface Resolution {
  dir: string;
  /** Whether this is the host's answer or a stand-in until it has one. */
  detected: boolean;
}

export class RemoteDirResolver {
  /** Host answers, keyed by scheme://authority. */
  private readonly resolved = new Map<string, string>();
  /** Detections under way, so concurrent callers share one round trip. */
  private readonly inFlight = new Map<string, Promise<Resolution>>();

  constructor(private readonly log: Logger) {}

  /**
   * @param configured the validated setting, or undefined to detect.
   * @returns an absolute POSIX directory; never rejects.
   */
  async resolve(template: vscode.Uri, configured: string | undefined): Promise<string> {
    if (configured !== undefined) return configured;

    const key = `${template.scheme}://${template.authority}`;
    const known = this.resolved.get(key);
    if (known !== undefined) return known;

    let pending = this.inFlight.get(key);
    if (pending === undefined) {
      pending = this.detect(template).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }

    const resolution = await pending;
    // A fallback is deliberately not cached. The first detection happens during
    // activation, when the remote file system may not be serving yet; caching
    // what came back then would make `/tmp` this window's answer for the whole
    // session, and two windows on the same host could disagree.
    if (resolution.detected) this.resolved.set(key, resolution.dir);
    return resolution.dir;
  }

  private async detect(template: vscode.Uri): Promise<Resolution> {
    const started = Date.now();
    try {
      const detection = await withTimeout(
        detectRemoteTempRoot(remoteProbe(template), this.log),
        DETECT_TIMEOUT_MS
      );
      if (detection === undefined) {
        this.log.warn(
          `the remote host did not answer within ${DETECT_TIMEOUT_MS}ms; ` +
            'using the default directory for this paste and trying again next time'
        );
        return { dir: remoteDirUnder(FALLBACK_REMOTE_TMP), detected: false };
      }

      const dir = remoteDirUnder(detection.root);
      this.log.debug(`resolved remote directory ${dir} in ${Date.now() - started}ms`);
      return { dir, detected: detection.detected };
    } catch (err) {
      // Nothing above is expected to throw; degrading beats a rejected promise
      // that every later paste would inherit.
      const dir = remoteDirUnder(FALLBACK_REMOTE_TMP);
      this.log.error(`remote temp detection failed (${describeError(err)}); using ${dir}`);
      return { dir, detected: false };
    }
  }
}

/** Resolves to undefined instead of waiting forever; always clears its timer. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

function remoteProbe(template: vscode.Uri): RemoteProbe {
  return {
    readFile: async (posixPath) => vscode.workspace.fs.readFile(remoteUri(template, posixPath)),
    isDirectory: async (posixPath) => {
      try {
        const stat = await vscode.workspace.fs.stat(remoteUri(template, posixPath));
        // Bitwise, because `/tmp` is a symlink on macOS and comes back as
        // SymbolicLink | Directory.
        return (stat.type & vscode.FileType.Directory) !== 0;
      } catch {
        return false;
      }
    },
  };
}
