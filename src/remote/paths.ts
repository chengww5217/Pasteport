/**
 * Remote path construction — pure string work, unit tested without VS Code.
 *
 * Layout: `<remoteDir>/<fingerprint>/<original name>`.
 *
 * The fingerprint is a directory rather than a filename prefix so the original
 * name survives: an agent reads `report.zip`, not `a1b2c3d4.zip`, while two
 * different files can never collide.
 *
 * Where `<remoteDir>` itself comes from is tempDir.ts's problem, not this
 * module's: everything here works on a directory it is handed.
 */

/** Longest name segment we will write; leaves room under the usual 255-byte cap. */
const MAX_NAME_LENGTH = 200;

/**
 * Validates and canonicalises the configured remote directory.
 *
 * Relative paths and `~` are rejected rather than guessed at: `workspace.fs`
 * resolves neither, so accepting them would produce a literal `~` directory on
 * the remote host.
 *
 * Control characters are rejected because this path is eventually written into
 * a terminal: an embedded newline would turn a paste into command execution.
 * The filesystem root is rejected because the TTL sweeper deletes fingerprint
 * directories recursively, and it must never be pointed at `/`.
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
  /* eslint-disable-next-line no-control-regex -- rejecting C0/C1 controls is the point */
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('remoteDir contains control characters');
  }

  const collapsed = trimmed.replace(/\/+/g, '/').replace(/\/+$/, '');
  if (collapsed === '') {
    throw new Error('remoteDir must name a directory below the filesystem root');
  }
  // `/tmp/..` denotes the root just as `/` does, and the sweeper deletes
  // recursively. Rejecting dot segments outright is simpler than resolving
  // them, and no legitimate configuration needs one.
  if (collapsed.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('remoteDir must not contain "." or ".." segments');
  }
  return collapsed;
}

/**
 * Reduces an arbitrary local file name to one safe remote path segment.
 *
 * Spaces and unicode are kept — macOS screenshot names contain both, and the
 * remote side never re-parses the segment. Two classes of character go: the ones
 * that would change the path's structure or break the protocol, and backtick and
 * `$`, which trigger substitution. `quoting: auto` inserts paths verbatim, so a
 * file called ``x`id`.png`` would otherwise carry live shell syntax to a prompt.
 * The remote name is cosmetic, which makes dropping a character far cheaper than
 * that risk.
 *
 * The rest of the shell's metacharacters stay: `(`, `)` and `&` are ordinary in
 * names a screenshot tool produces, and stripping them would mangle the common
 * case to half-solve a problem `quoting: shell` solves properly. Substitution is
 * singled out because it is the form that runs a command from inside what looks
 * like a file name.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    /* eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point */
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[`$]/g, '')
    .trim();

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
  return `${normalizeRemoteDir(remoteDir)}/${fingerprint}`;
}

export function remoteFilePath(remoteDir: string, fingerprint: string, name: string): string {
  return `${remoteDirForFingerprint(remoteDir, fingerprint)}/${sanitizeFileName(name)}`;
}
