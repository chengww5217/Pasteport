/**
 * Whether the paste key can reach this extension when the terminal has focus.
 *
 * Pure module, no vscode: this decision determines whether the user is shown a
 * dialog, and being wrong in either direction is user-visible, so it is unit
 * tested directly.
 *
 * Background: a key pressed in a focused terminal becomes a workbench command
 * only if xterm.js declines to consume it, or if the command it resolves to is
 * listed in `terminal.integrated.commandsToSkipShell`. macOS is unaffected —
 * xterm.js maps no Cmd combination to terminal input except Cmd+A — while
 * `Ctrl+V` is turned into `^V` and consumed, so on Windows the keybinding is
 * inert unless our command is in that list.
 *
 * The manifest contributes the entry via `configurationDefaults`, which is safe:
 * VS Code's skip list is a hardcoded array (`DEFAULT_COMMANDS_TO_SKIP_SHELL`)
 * that the configured value is concatenated onto, so contributing a value can
 * never remove Ctrl+C and friends. Only an explicit `-command` entry drops a
 * default.
 *
 * What a contributed default cannot cover is a user who has their own array in
 * settings.json: a user value replaces the default outright, ours included.
 */

export const SKIP_SHELL_SECTION = 'terminal.integrated';
export const SKIP_SHELL_KEY = 'commandsToSkipShell';
export const PASTE_COMMAND = 'pasteport.paste';

export function needsSkipShellEntry(
  configured: readonly string[] | undefined,
  command: string
): boolean {
  // Unset means the contributed default applies, which already includes us.
  if (configured === undefined) return false;
  if (configured.includes(command)) return false;
  // An explicit removal is a deliberate choice; do not argue with it.
  if (configured.includes(`-${command}`)) return false;
  return true;
}
