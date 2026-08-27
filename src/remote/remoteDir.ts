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
 * is one or two round trips. Those are memoised per remote authority: the answer
 * cannot change while a window stays attached to the same host, and a paste must
 * not pay for detection twice.
 */
export class RemoteDirResolver {
  private readonly detected = new Map<string, Promise<string>>();

  constructor(private readonly log: Logger) {}

  /**
   * @param configured the validated setting, or undefined to detect.
   * @returns an absolute POSIX directory; never rejects.
   */
  async resolve(template: vscode.Uri, configured: string | undefined): Promise<string> {
    if (configured !== undefined) return configured;

    const key = `${template.scheme}://${template.authority}`;
    let pending = this.detected.get(key);
    if (pending === undefined) {
      pending = this.detect(template);
      this.detected.set(key, pending);
    }
    return pending;
  }

  private async detect(template: vscode.Uri): Promise<string> {
    const started = Date.now();
    try {
      const root = await detectRemoteTempRoot(remoteProbe(template), this.log);
      const dir = remoteDirUnder(root);
      this.log.debug(`resolved remote directory ${dir} in ${Date.now() - started}ms`);
      return dir;
    } catch (err) {
      // Nothing above is expected to throw. If it does, a cached rejection would
      // break every later paste in this window, so it degrades instead.
      const fallback = remoteDirUnder(FALLBACK_REMOTE_TMP);
      this.log.error(`remote temp detection failed (${describeError(err)}); using ${fallback}`);
      return fallback;
    }
  }
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
