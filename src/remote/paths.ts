/**
 * Remote path construction — pure string work, unit tested without VS Code.
 *
 * Layout: `<remoteDir>/<fingerprint>/<original name>`.
 *
 * The fingerprint is a directory rather than a filename prefix so the original
 * name survives: an agent reads `report.zip`, not `a1b2c3d4.zip`, while two
 * different files can never collide.
 */

export const DEFAULT_REMOTE_DIR = '/tmp/pasteport';

/** Longest name segment we will write; leaves room under the usual 255-byte cap. */
const MAX_NAME_LENGTH = 200;

/**
 * Validates and canonicalises the configured remote directory.
 *
 * Relative paths and `~` are rejected rather than guessed at: `workspace.fs`
 * resolves neither, so accepting them would produce a literal `~` directory on
 * the remote host.
 *
 * @throws Error when the value cannot be used as an absolute POSIX directory.
 */
export function normalizeRemoteDir(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error('remoteDir is empty');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error(
      `remoteDir must be an absolute POSIX path (got ${JSON.stringify(value)}); ` +
        '"~" is not expanded by the remote file system'
    );
  }
  const collapsed = trimmed.replace(/\/+/g, '/').replace(/\/+$/, '');
  return collapsed === '' ? '/' : collapsed;
}

/**
 * Reduces an arbitrary local file name to one safe remote path segment.
 *
 * Spaces and unicode are kept — macOS screenshot names contain both, and the
 * remote side never re-parses the segment. Only characters that would change
 * the path's structure or break the protocol are removed.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  /* eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point */
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();

  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file';
  return truncateName(cleaned);
}

/** Shortens the stem, never the extension, so file type stays recognisable. */
function truncateName(name: string): string {
  if (Buffer.byteLength(name) <= MAX_NAME_LENGTH) return name;

  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const extBytes = Buffer.byteLength(ext);
  const budget = extBytes < MAX_NAME_LENGTH ? MAX_NAME_LENGTH - extBytes : MAX_NAME_LENGTH;

  const stem = dot > 0 ? name.slice(0, dot) : name;
  const truncatedStem = truncateToBytes(stem, budget);
  return extBytes < MAX_NAME_LENGTH ? `${truncatedStem}${ext}` : truncatedStem;
}

/** Byte-budget truncation that never splits a multi-byte character. */
function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const slice = Buffer.from(value).subarray(0, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(slice).replace(/\ufffd+$/, '');
}

export function remoteDirForFingerprint(remoteDir: string, fingerprint: string): string {
  const base = normalizeRemoteDir(remoteDir);
  return base === '/' ? `/${fingerprint}` : `${base}/${fingerprint}`;
}

export function remoteFilePath(remoteDir: string, fingerprint: string, name: string): string {
  return `${remoteDirForFingerprint(remoteDir, fingerprint)}/${sanitizeFileName(name)}`;
}
