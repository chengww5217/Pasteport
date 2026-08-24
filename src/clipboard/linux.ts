import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { describeError, type Logger } from '../log';
import type { ClipboardContent } from './types';

const execFileAsync = promisify(execFile);

/**
 * Linux clipboard reader.
 *
 * Unlike macOS and Windows there is no system API to call: the clipboard lives
 * in the display server, and the way to reach it from a process is the standard
 * command line tool for that protocol. Those tools already speak a simple text
 * protocol, so this reader talks to them directly instead of shipping a shell
 * script — a script would add a second parsing layer and a /bin/sh dependency
 * without removing any work.
 *
 * The consequence, unique to this platform, is an external dependency: neither
 * tool is guaranteed to be installed, so "not installed" is a first-class
 * outcome with an actionable message rather than a silent failure.
 */

/** Reading the clipboard is local; anything slower than this is stuck. */
const READ_TIMEOUT_MS = 10_000;

/** Target lists are a few hundred bytes. */
const MAX_TARGETS_BYTES = 64 * 1024;

/** Pasted images are occasionally large; this is a ceiling, not an expectation. */
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;

/** The only image flavour taken: the contract says staged images are PNG. */
export const IMAGE_TARGET = 'image/png';

/** File list flavours, in the order they are preferred. */
export const FILE_TARGETS = ['x-special/gnome-copied-files', 'text/uri-list'] as const;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type LinuxBackend = 'wayland' | 'x11';

export interface LinuxSessionEnv {
  WAYLAND_DISPLAY?: string | undefined;
  DISPLAY?: string | undefined;
  XDG_SESSION_TYPE?: string | undefined;
}

/**
 * Which tools to try, in order.
 *
 * A Wayland session usually also runs XWayland, and an application started
 * under it can own the X11 selection instead, so Wayland-first-then-X11 is more
 * robust than picking one. An empty result means there is no graphical session
 * to read from at all, which is a different problem from a missing tool and is
 * reported as such.
 */
export function chooseBackends(env: LinuxSessionEnv): LinuxBackend[] {
  const backends: LinuxBackend[] = [];

  const waylandLikely =
    (env.WAYLAND_DISPLAY ?? '') !== '' || (env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland';
  if (waylandLikely) backends.push('wayland');
  if ((env.DISPLAY ?? '') !== '') backends.push('x11');

  return backends;
}

export function targetsCommand(backend: LinuxBackend): [string, string[]] {
  return backend === 'wayland'
    ? ['wl-paste', ['--list-types']]
    : ['xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']];
}

export function readCommand(backend: LinuxBackend, target: string): [string, string[]] {
  return backend === 'wayland'
    ? ['wl-paste', ['--no-newline', '--type', target]]
    : ['xclip', ['-selection', 'clipboard', '-t', target, '-o']];
}

/** Package name to suggest when the tool for a backend is absent. */
export function installHint(backend: LinuxBackend): string {
  return backend === 'wayland'
    ? 'wl-paste is missing — install wl-clipboard (for example: apt install wl-clipboard)'
    : 'xclip is missing — install xclip (for example: apt install xclip)';
}

export function parseTargets(stdout: string): string[] {
  const seen = new Set<string>();
  for (const line of stdout.split('\n')) {
    const target = line.trim();
    if (target !== '') seen.add(target);
  }
  return [...seen];
}

export function pickFileTarget(targets: readonly string[]): string | undefined {
  return FILE_TARGETS.find((candidate) => targets.includes(candidate));
}

/**
 * Turns a `text/uri-list` body into local paths.
 *
 * Copying a hyperlink in a browser also produces `text/uri-list`, so anything
 * that is not a local `file:` URI is dropped rather than guessed at — the caller
 * then sees an empty list and passes the paste through.
 */
export function parseUriList(body: string): string[] {
  const paths: string[] = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    // '#' starts a comment in the uri-list format, and the GNOME flavour puts
    // its operation ('copy' / 'cut') on the first line.
    if (line === '' || line.startsWith('#') || line === 'copy' || line === 'cut') continue;

    const resolved = fileUriToPath(line);
    if (resolved !== undefined) paths.push(resolved);
  }

  return paths;
}

/**
 * `file:///a/b` -> `/a/b`, and undefined for anything not a readable local path.
 *
 * A URI naming another host is a file we cannot read locally, so it is dropped
 * rather than turned into a path that happens to exist here.
 */
export function fileUriToPath(uri: string): string | undefined {
  const match = /^file:\/\/([^/]*)(\/.*)$/.exec(uri);
  if (match === null) return undefined;

  const [, host, encodedPath] = match;
  if (host !== '' && host !== 'localhost') return undefined;
  if (encodedPath === undefined) return undefined;

  try {
    const decoded = decodeURIComponent(encodedPath);
    return decoded === '' ? undefined : decoded;
  } catch {
    // A malformed percent escape is not a path we can use.
    return undefined;
  }
}

/** Matches STAGED_IMAGE_PATTERN, which the TTL sweeper keys on. */
export function stagedImageName(now: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-` +
    `${pad(now.getMilliseconds(), 3)}`;
  return `clipboard-${stamp}.png`;
}

export interface LinuxReaderOptions {
  stagingDir: string;
  log: Logger;
  /** Injectable for tests; defaults to the real environment. */
  env?: LinuxSessionEnv;
}

export async function readLinuxClipboard(options: LinuxReaderOptions): Promise<ClipboardContent> {
  const { stagingDir, log } = options;
  const env: LinuxSessionEnv = options.env ?? {
    WAYLAND_DISPLAY: process.env['WAYLAND_DISPLAY'],
    DISPLAY: process.env['DISPLAY'],
    XDG_SESSION_TYPE: process.env['XDG_SESSION_TYPE'],
  };

  const backends = chooseBackends(env);
  if (backends.length === 0) {
    return {
      kind: 'error',
      actionable: true,
      message:
        'no graphical session found (neither WAYLAND_DISPLAY nor DISPLAY is set), ' +
        'so the clipboard cannot be read',
    };
  }

  try {
    await fs.mkdir(stagingDir, { recursive: true });
  } catch (err) {
    return {
      kind: 'error',
      message: `cannot create staging directory ${stagingDir}: ${describeError(err)}`,
    };
  }

  const missing: string[] = [];
  let lastTargets: string[] = [];

  for (const backend of backends) {
    const started = Date.now();
    const [command, args] = targetsCommand(backend);
    const listed = await run(command, args, MAX_TARGETS_BYTES);

    if (listed.status === 'missing') {
      missing.push(installHint(backend));
      continue;
    }
    if (listed.status === 'failed') {
      // wl-paste and xclip both exit non-zero for an empty clipboard, which is
      // an ordinary state, not an error worth reporting.
      log.debug(`${command} could not list clipboard types: ${listed.message}`);
      continue;
    }

    const targets = parseTargets(listed.stdout.toString('utf8'));
    log.trace(`clipboard types via ${command} in ${Date.now() - started}ms: ${targets.join(', ')}`);
    if (targets.length === 0) continue;
    lastTargets = targets;

    const content = await readFromBackend(backend, targets, stagingDir, log);
    if (content !== undefined) return content;
  }

  if (missing.length === backends.length && missing.length > 0) {
    return { kind: 'error', actionable: true, message: missing.join('; ') };
  }

  return { kind: 'other', types: lastTargets };
}

/** Returns undefined when this backend holds nothing we handle. */
async function readFromBackend(
  backend: LinuxBackend,
  targets: readonly string[],
  stagingDir: string,
  log: Logger
): Promise<ClipboardContent | undefined> {
  // Files before images, as on the other platforms: a file manager copy also
  // offers a thumbnail, and the file itself is what the user meant.
  const fileTarget = pickFileTarget(targets);
  if (fileTarget !== undefined) {
    const [command, args] = readCommand(backend, fileTarget);
    const result = await run(command, args, MAX_TARGETS_BYTES);
    if (result.status === 'ok') {
      const paths = parseUriList(result.stdout.toString('utf8'));
      if (paths.length > 0) return { kind: 'files', paths };
      log.debug(`${fileTarget} held no local file URIs`);
    } else {
      log.debug(`could not read ${fileTarget}: ${describeMissing(result)}`);
    }
  }

  if (!targets.includes(IMAGE_TARGET)) return undefined;

  const [command, args] = readCommand(backend, IMAGE_TARGET);
  const result = await run(command, args, MAX_IMAGE_BYTES);
  if (result.status !== 'ok') {
    log.debug(`could not read ${IMAGE_TARGET}: ${describeMissing(result)}`);
    return undefined;
  }
  if (result.stdout.length === 0) return undefined;

  // The clipboard advertised PNG; if what arrives is not one, staging it would
  // hand an agent a file that lies about its type.
  if (!result.stdout.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { kind: 'error', message: `${IMAGE_TARGET} did not contain PNG data` };
  }

  const target = path.join(stagingDir, stagedImageName(new Date()));
  try {
    await fs.writeFile(target, result.stdout);
  } catch (err) {
    return { kind: 'error', message: `could not stage clipboard image: ${describeError(err)}` };
  }
  return { kind: 'image', paths: [target] };
}

type RunResult =
  | { status: 'ok'; stdout: Buffer }
  | { status: 'missing'; message: string }
  | { status: 'failed'; message: string };

async function run(command: string, args: string[], maxBuffer: number): Promise<RunResult> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: READ_TIMEOUT_MS,
      maxBuffer,
      encoding: 'buffer',
    });
    return { status: 'ok', stdout };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing', message: `${command} is not installed` };
    }
    return { status: 'failed', message: describeError(err) };
  }
}

function describeMissing(result: Exclude<RunResult, { status: 'ok' }>): string {
  return result.message;
}
