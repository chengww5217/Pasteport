/**
 * Finding out where "temp" is on the remote host.
 *
 * `/tmp` is the POSIX convention, not a promise. A host can point `TMPDIR` at a
 * per-user directory, put it on a different volume, or mount `/tmp` read-only —
 * and images pasted for an agent to read are exactly the kind of throwaway file
 * that belongs wherever the host says throwaway files go. Hardcoding `/tmp`
 * would quietly ignore that decision.
 *
 * Detection is done with reads rather than commands, because this extension
 * runs in the *local* extension host and has no way to execute anything on the
 * remote side. What it does have is `workspace.fs`, whose calls are served by
 * the remote server process — so `/proc/self/environ` is that process's own
 * environment, and the server was started from the user's login environment.
 * Its `TMPDIR` is therefore the value the host actually configured, obtained
 * without spawning a shell.
 *
 * Only the temp variables are ever read out of that environment, and nothing
 * else from it is logged or kept: the rest of a login environment is none of
 * this extension's business.
 *
 * Pure module — the remote is reached through an injected probe, so this is unit
 * tested without VS Code.
 */

import { describeError, type Logger } from '../log';
import { normalizeRemoteDir } from './paths';

/** Directory created under the remote temp root; also our own marker there. */
export const REMOTE_DIR_NAME = 'pasteport';

/** Used when the host tells us nothing at all. */
export const FALLBACK_REMOTE_TMP = '/tmp';

/** Probed in order when the environment yields nothing usable. */
export const TMP_CANDIDATES: readonly string[] = ['/tmp', '/var/tmp'];

/** The remote server process's environment, on Linux remotes. */
export const ENVIRON_PATH = '/proc/self/environ';

/** Consulted in order of precedence; `TMPDIR` is the POSIX spelling. */
const TMP_VARS: readonly string[] = ['TMPDIR', 'TMP', 'TEMP'];

/** The remote side of detection, narrowed to the two reads it needs. */
export interface RemoteProbe {
  /** Rejects when the path cannot be read; never expected to throw otherwise. */
  readFile(posixPath: string): Promise<Uint8Array>;
  /** False for "missing", "not a directory" and "could not tell" alike. */
  isDirectory(posixPath: string): Promise<boolean>;
}

export interface TempRootDetection {
  root: string;
  /**
   * False when nothing answered and the fallback was taken.
   *
   * The caller needs to tell the two apart: at startup the remote file system
   * may not be serving yet, and a fallback remembered from that moment would
   * become the answer for the rest of the session.
   */
  detected: boolean;
}

/**
 * Extracts a usable temp directory from a NUL-separated `environ` blob.
 *
 * Values go through `normalizeRemoteDir`, so a relative, empty or
 * control-character-bearing `TMPDIR` is skipped rather than trusted; the next
 * variable, and then the candidate probe, still get their turn.
 */
export function parseTempDirFromEnviron(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const values = new Map<string, string>();

  for (const entry of text.split('\0')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const name = entry.slice(0, separator);
    // First occurrence wins: a duplicated variable is what `execve` saw first.
    if (!TMP_VARS.includes(name) || values.has(name)) continue;
    values.set(name, entry.slice(separator + 1));
  }

  for (const name of TMP_VARS) {
    const value = values.get(name);
    if (value === undefined) continue;
    try {
      return normalizeRemoteDir(value);
    } catch {
      // Not usable as a remote directory; try the next variable.
    }
  }
  return undefined;
}

/**
 * Resolves the remote temp root: the host's own `TMPDIR` if it has one, else the
 * first standard location that exists, else `/tmp` and a warning.
 *
 * Never throws — a failed detection has to degrade into a working default, since
 * the caller is in the middle of a paste.
 */
export async function detectRemoteTempRoot(
  probe: RemoteProbe,
  log: Logger
): Promise<TempRootDetection> {
  const fromEnviron = await tempRootFromEnviron(probe, log);
  if (fromEnviron !== undefined) return { root: fromEnviron, detected: true };

  for (const candidate of TMP_CANDIDATES) {
    if (await probe.isDirectory(candidate)) {
      log.info(`remote temp directory: ${candidate} (found by probing)`);
      return { root: candidate, detected: true };
    }
  }

  log.warn(
    `no remote temp directory could be detected (tried ${ENVIRON_PATH} and ` +
      `${TMP_CANDIDATES.join(', ')}); using ${FALLBACK_REMOTE_TMP} for now`
  );
  return { root: FALLBACK_REMOTE_TMP, detected: false };
}

async function tempRootFromEnviron(probe: RemoteProbe, log: Logger): Promise<string | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await probe.readFile(ENVIRON_PATH);
  } catch (err) {
    // Expected on any remote without procfs — macOS, for one. Not a warning.
    log.debug(`${ENVIRON_PATH} is not readable (${describeError(err)}); probing instead`);
    return undefined;
  }

  const candidate = parseTempDirFromEnviron(bytes);
  if (candidate === undefined) {
    log.debug(`${ENVIRON_PATH} names no usable ${TMP_VARS.join('/')}; probing instead`);
    return undefined;
  }
  // Deliberately not distinguishing "not a directory" from "could not stat it":
  // either way this value cannot be used, and the probe below is the answer.
  if (!(await probe.isDirectory(candidate))) {
    log.warn(
      `the temp directory named by the remote environment (${candidate}) could not be ` +
        'confirmed as a directory; probing instead'
    );
    return undefined;
  }

  log.info(`remote temp directory: ${candidate} (from the remote server's environment)`);
  return candidate;
}

/** `<tempRoot>/pasteport`, the directory pasted files actually land under. */
export function remoteDirUnder(tempRoot: string): string {
  return `${normalizeRemoteDir(tempRoot)}/${REMOTE_DIR_NAME}`;
}
