import * as vscode from 'vscode';

/**
 * Resolving where "remote" is.
 *
 * The whole backend-independence claim rests on this file: we never build a
 * remote URI from parts, we borrow one the window already has and swap its
 * path. Scheme and authority come along untouched, so ssh-remote, dev
 * containers, WSL, tunnels and Codespaces all take the same code path and
 * Remote-SSH's occasionally hex-encoded authority never has to be parsed.
 */

/**
 * A URI belonging to this window, usable as a template.
 *
 * Two conditions, because either alone is wrong. `env.remoteName` says the
 * window is attached to a remote host but gives no URI to build from; a
 * non-file URI on its own can be a virtual file system (`vscode-vfs:` for a
 * GitHub repository, say) opened in a purely local window, where there is no
 * remote host to upload to.
 *
 * `env.remoteAuthority` would be the direct route and is deliberately avoided:
 * it is not public API, whereas `remoteName` is.
 */
export function remoteTemplateUri(): vscode.Uri | undefined {
  if (vscode.env.remoteName === undefined) return undefined;

  const candidates: Array<vscode.Uri | undefined> = [
    ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
    vscode.window.activeTextEditor?.document.uri,
  ];

  for (const uri of candidates) {
    if (uri && uri.scheme !== 'file' && uri.authority !== '') return uri;
  }
  return undefined;
}

/** Same scheme and authority as the template, different path. */
export function remoteUri(template: vscode.Uri, posixPath: string): vscode.Uri {
  return template.with({ path: posixPath, query: '', fragment: '' });
}

/**
 * Whether the window's remote file system accepts writes.
 *
 * `isWritableFileSystem` returns undefined for a scheme VS Code does not know,
 * and false for a read-only provider; both mean "do not try to upload". This is
 * a cheap up-front check that replaces discovering the problem mid-transfer.
 */
export function isWritableRemote(template: vscode.Uri): boolean {
  return vscode.workspace.fs.isWritableFileSystem(template.scheme) === true;
}
