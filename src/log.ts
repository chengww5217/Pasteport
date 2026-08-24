/**
 * The logging surface the non-vscode modules depend on.
 *
 * `vscode.LogOutputChannel` satisfies this structurally, so the extension
 * passes the real channel in while tests can pass a recorder — and the modules
 * that do the actual work stay importable outside the extension host.
 */
export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
  /** Brings the log into view; `vscode.LogOutputChannel.show` matches. */
  show(preserveFocus?: boolean): void;
}

/** Discards everything; used where a logger is optional. */
export const silentLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

/** Renders any thrown value as one log line. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message === '' ? err.name : `${err.name}: ${err.message}`;
  }
  return String(err);
}
