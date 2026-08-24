/**
 * Path quoting strategies.
 *
 * The pasted text goes into a terminal, but what reads it is not always a
 * shell: the target scenario is a TUI agent (Claude Code and friends) which
 * treats the line as literal text. Quoting there is actively harmful — the
 * quotes become part of the path. Hence three explicit modes instead of
 * unconditional shell quoting.
 *
 * This module is pure: no vscode, no fs. It is unit tested directly.
 */

export type QuotingMode = 'auto' | 'shell' | 'none';

/**
 * Characters that need no quoting in POSIX shells. Deliberately conservative:
 * anything outside this set gets single-quoted rather than escaped per-char.
 */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Single-quote wrap, closing/reopening around embedded single quotes. */
export function shellQuote(value: string): string {
  if (value !== '' && SHELL_SAFE.test(value)) return value;
  return `'${value.split("'").join(`'\\''`)}'`;
}

export function quotePath(value: string, mode: QuotingMode): string {
  switch (mode) {
    case 'shell':
      return shellQuote(value);
    case 'none':
      return value;
    // R2 is open: whether TUI agents strip quotes themselves is unverified,
    // so `auto` deliberately behaves like `none` — the primary target does no
    // shell parsing, and a stray quote there is a wrong path, while a missing
    // quote in a shell is a visible, recoverable error.
    case 'auto':
      return value;
  }
}

export interface FormatOptions {
  mode: QuotingMode;
  trailingSpace: boolean;
}

/** Builds the exact text injected into the terminal. */
export function formatPathsForTerminal(paths: readonly string[], options: FormatOptions): string {
  const text = paths.map((p) => quotePath(p, options.mode)).join(' ');
  if (text === '') return '';
  return options.trailingSpace ? `${text} ` : text;
}
