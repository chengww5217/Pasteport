import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

import { describeError, type Logger } from './log';
import {
  choosePackageManager,
  ELEVATOR,
  installArgv,
  renderCommand,
  type PackageManagerSpec,
} from './installPolicy';

const execFileAsync = promisify(execFile);

/**
 * Offering to install a missing Linux clipboard tool.
 *
 * Two facts shape this. First, the tool is needed on the machine running the
 * extension host — the local one — while a terminal opened in a remote window
 * runs on the remote host, so the integrated terminal is the wrong instrument
 * however natural it looks. Second, installing needs root, and a desktop session
 * has no terminal in front of the user to type a password into.
 *
 * `pkexec` answers both: it is spawned locally and prompts for authentication
 * through the desktop's own polkit agent. Where that is unavailable, the exact
 * command is shown instead of anything clever being attempted.
 */

/** Directories searched for a package manager, in PATH-like order. */
const BIN_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];

/** Installing a package is not instant, but it is not minutes either. */
const INSTALL_TIMEOUT_MS = 180_000;

export async function offerPackageInstall(
  packages: readonly string[],
  reason: string,
  log: Logger
): Promise<void> {
  if (process.platform !== 'linux' || packages.length === 0) return;

  const binaries = await availableBinaries();
  const manager = choosePackageManager((binary) => binaries.has(binary));
  if (manager === undefined) {
    log.warn(`no supported package manager found; install ${packages.join(' ')} manually`);
    await showManualInstructions(packages, undefined, log);
    return;
  }

  // Absolute paths, not bare names: this is about to run as root, and PATH is
  // not something to trust at that point.
  const elevator = await resolveBinary(ELEVATOR);
  const [command, args] = installArgv(manager, packages, {
    manager: binaries.get(manager.binary),
    elevator,
  });
  const rendered = renderCommand(command, args);

  const install = vscode.l10n.t('Install');
  const show = vscode.l10n.t('Show Command');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('Pasteport: {0}', reason),
    {
      modal: true,
      // The exact command, verbatim: this runs as root on the user's machine and
      // they are entitled to read it before agreeing, not after.
      detail: vscode.l10n.t(
        'Install it with {0}? Pasteport will run:\n\n{1}\n\nYour desktop will ask for authentication.',
        manager.id,
        rendered
      ),
    },
    install,
    show
  );

  if (choice === show) {
    await showManualInstructions(packages, manager, log);
    return;
  }
  if (choice !== install) {
    log.debug('package install declined');
    return;
  }

  if (elevator === undefined) {
    log.warn(`${ELEVATOR} is not available, so the install cannot ask for authentication`);
    await showManualInstructions(packages, manager, log);
    return;
  }

  await runInstall(command, args, rendered, packages, manager, log);
}

async function runInstall(
  command: string,
  args: readonly string[],
  rendered: string,
  packages: readonly string[],
  manager: PackageManagerSpec,
  log: Logger
): Promise<void> {
  log.info(`running: ${rendered}`);

  const failure = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Pasteport: installing {0}', packages.join(' ')),
      cancellable: false,
    },
    async (): Promise<string | undefined> => {
      try {
        const { stdout, stderr } = await execFileAsync(command, [...args], {
          timeout: INSTALL_TIMEOUT_MS,
          encoding: 'utf8',
        });
        if (stdout.trim() !== '') log.debug(stdout.trim());
        if (stderr.trim() !== '') log.debug(stderr.trim());
        return undefined;
      } catch (err) {
        // pkexec exits 126 when authentication is dismissed and 127 when no
        // agent could be reached; the package manager's own output is more
        // useful than either, so all of it goes to the log.
        const detail = execOutput(err);
        if (detail !== '') log.warn(detail);
        return describeError(err);
      }
    }
  );

  if (failure === undefined) {
    log.info(`installed ${packages.join(' ')}`);
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Pasteport: installed {0}. Press paste again.', packages.join(' '))
    );
    return;
  }

  log.error(`install failed: ${failure}`);
  const showCommand = vscode.l10n.t('Show Command');
  const showLog = vscode.l10n.t('Show Log');
  const choice = await vscode.window.showErrorMessage(
    vscode.l10n.t('Pasteport: could not install {0}.', packages.join(' ')),
    showCommand,
    showLog
  );
  if (choice === showLog) log.show(true);
  if (choice === showCommand) await showManualInstructions(packages, manager, log);
}

/**
 * Falls back to telling the user what to run.
 *
 * The command goes to the log rather than the clipboard on purpose: the user
 * reached this dialog while trying to paste something, and overwriting their
 * clipboard would destroy exactly what they were about to send.
 */
async function showManualInstructions(
  packages: readonly string[],
  manager: PackageManagerSpec | undefined,
  log: Logger
): Promise<void> {
  const rendered =
    manager === undefined
      ? `<your package manager> install ${packages.join(' ')}`
      : renderCommand(...installArgv(manager, packages));

  log.info(`install ${packages.join(' ')} by running: ${rendered}`);
  log.show(true);

  await vscode.window.showInformationMessage(
    vscode.l10n.t('Pasteport: run this in a local terminal — {0}', rendered)
  );
}

/** Package manager name -> absolute path, for the managers this machine has. */
async function availableBinaries(): Promise<Map<string, string>> {
  const managers = ['apt-get', 'dnf', 'pacman', 'zypper', 'apk', 'xbps-install', 'eopkg'];
  const found = new Map<string, string>();

  await Promise.all(
    managers.map(async (binary) => {
      const resolved = await resolveBinary(binary);
      if (resolved !== undefined) found.set(binary, resolved);
    })
  );
  return found;
}

/** First BIN_DIRS hit, so the search order is PATH-like and deterministic. */
async function resolveBinary(binary: string): Promise<string | undefined> {
  for (const dir of BIN_DIRS) {
    const candidate = path.join(dir, binary);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function execOutput(err: unknown): string {
  const withStreams = err as { stdout?: unknown; stderr?: unknown };
  return [withStreams.stdout, withStreams.stderr]
    .filter((stream): stream is string => typeof stream === 'string' && stream.trim() !== '')
    .join('\n')
    .trim();
}
