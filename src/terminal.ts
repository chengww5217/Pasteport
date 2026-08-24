import * as vscode from 'vscode';

import { describeError, type Logger } from './log';

/**
 * Getting text into the terminal.
 *
 * `workbench.action.terminal.sendSequence` is used rather than
 * `Terminal.sendText`: it is a renderer-side core command, so it does not care
 * which extension host asks. A UI extension in a remote window reportedly does
 * see `window.activeTerminal`, but the API makes no promise about that, and a
 * core command needs no such promise.
 */

const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';

/**
 * Hands the keystroke back to VS Code unchanged.
 *
 * This is the default outcome for anything we do not handle — text, an empty
 * clipboard, a folder, a local window, an unsupported platform. Cmd+V is bound
 * unconditionally, so every one of those paths must end here rather than in an
 * error.
 */
export async function passThroughPaste(log: Logger): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.terminal.paste');
  } catch (err) {
    log.warn(`native terminal paste failed: ${describeError(err)}`);
  }
}

export interface InjectOptions {
  bracketedPaste: boolean;
  log: Logger;
}

/**
 * Writes `text` into the focused terminal. Never appends a newline — nothing
 * here should run a command on the user's behalf.
 */
export async function injectText(text: string, options: InjectOptions): Promise<boolean> {
  if (text === '') return true;

  const payload = options.bracketedPaste
    ? `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`
    : text;

  // sendSequence resolves ${...} variables in its argument, which would mangle
  // a path that happens to contain one. Rare, but silently wrong, so such paths
  // take the clipboard route instead.
  if (payload.includes('${')) {
    options.log.debug('path contains "${", using the clipboard route to avoid variable expansion');
    return injectViaClipboard(payload, options.log);
  }

  try {
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: payload,
    });
    return true;
  } catch (err) {
    options.log.warn(`sendSequence failed (${describeError(err)}); falling back to the clipboard`);
    return injectViaClipboard(payload, options.log);
  }
}

/**
 * Last resort: put the text on the clipboard and trigger a normal paste.
 *
 * This overwrites what the user copied. That is a real cost, which is why it is
 * only reached when direct injection is impossible — at that point the
 * alternative is losing the transfer that already happened.
 */
async function injectViaClipboard(text: string, log: Logger): Promise<boolean> {
  try {
    await vscode.env.clipboard.writeText(text);
    await vscode.commands.executeCommand('workbench.action.terminal.paste');
    log.info('injected via clipboard; the original clipboard contents were replaced');
    return true;
  } catch (err) {
    log.error(`could not inject the remote path: ${describeError(err)}`);
    return false;
  }
}
