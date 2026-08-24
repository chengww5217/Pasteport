/**
 * Choosing how to install a missing Linux clipboard tool.
 *
 * Pure module, no vscode and no child_process: what gets run as root on the
 * user's machine is decided here, so it is unit tested directly and can be read
 * in one sitting.
 *
 * Two deliberate limits:
 *  - the argv is fixed per manager, never assembled from user input;
 *  - no repository refresh, no upgrade, no `-y` on managers where that would
 *    imply more than installing the named package. Installing one package is
 *    the whole mandate.
 */

export type PackageManagerId = 'apt' | 'dnf' | 'pacman' | 'zypper' | 'apk' | 'xbps' | 'eopkg';

export interface PackageManagerSpec {
  id: PackageManagerId;
  /** Executable to look for when detecting the distribution's manager. */
  binary: string;
  /** Arguments that install the named packages without further prompting. */
  install: (packages: readonly string[]) => string[];
}

/**
 * Ordered by how likely they are to coexist: `apt-get` and `dnf` never appear on
 * the same system, so order only matters for oddities, but a stable order keeps
 * the behaviour predictable.
 */
export const PACKAGE_MANAGERS: readonly PackageManagerSpec[] = [
  { id: 'apt', binary: 'apt-get', install: (p) => ['install', '-y', ...p] },
  { id: 'dnf', binary: 'dnf', install: (p) => ['install', '-y', ...p] },
  { id: 'pacman', binary: 'pacman', install: (p) => ['-S', '--needed', '--noconfirm', ...p] },
  { id: 'zypper', binary: 'zypper', install: (p) => ['--non-interactive', 'install', ...p] },
  { id: 'apk', binary: 'apk', install: (p) => ['add', ...p] },
  { id: 'xbps', binary: 'xbps-install', install: (p) => ['-y', ...p] },
  { id: 'eopkg', binary: 'eopkg', install: (p) => ['install', '-y', ...p] },
];

/**
 * Source-based distributions are intentionally absent. An unattended `emerge`
 * can compile for an hour, which is not something to start from a keystroke; on
 * those systems the command is shown and the user runs it themselves.
 */
export function choosePackageManager(
  isAvailable: (binary: string) => boolean
): PackageManagerSpec | undefined {
  return PACKAGE_MANAGERS.find((manager) => isAvailable(manager.binary));
}

/** The privilege helper: it prompts graphically, which a terminal-less GUI needs. */
export const ELEVATOR = 'pkexec';

/** Full argv, root helper included, exactly as it will be spawned. */
export function installArgv(
  manager: PackageManagerSpec,
  packages: readonly string[]
): [string, string[]] {
  return [ELEVATOR, [manager.binary, ...manager.install(packages)]];
}

/** The same command as one copy-pasteable line, for dialogs and the log. */
export function renderCommand(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ');
}
