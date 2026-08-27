import * as vscode from 'vscode';

import { describeError, type Logger } from './log';
import {
  needsSkipShellEntry,
  PASTE_COMMAND,
  SKIP_SHELL_KEY,
  SKIP_SHELL_SECTION,
} from './skipShellPolicy';

/**
 * Offers to make the paste key reach this extension on Windows and Linux.
 *
 * See skipShellPolicy.ts for why this is necessary and why the contributed
 * default alone is not enough.
 */

/** Persistence for "don't ask again"; backed by globalState in the extension. */
export interface PromptSuppression {
  isSuppressed(): boolean;
  suppress(): void;
}

export async function ensurePasteKeyReachesExtension(
  log: Logger,
  suppression: PromptSuppression
): Promise<void> {
  // macOS never needs this; other platforms have no reader, so the command would
  // pass the paste through regardless.
  if (process.platform !== 'win32' && process.platform !== 'linux') return;

  const section = vscode.workspace.getConfiguration(SKIP_SHELL_SECTION);
  const configured = section.get<string[]>(SKIP_SHELL_KEY);
  if (!needsSkipShellEntry(configured, PASTE_COMMAND)) return;

  log.warn(
    `${SKIP_SHELL_SECTION}.${SKIP_SHELL_KEY} is set in your settings and does not include ` +
      `${PASTE_COMMAND}, so the paste key is delivered to the shell instead of this extension`
  );
  if (suppression.isSuppressed()) return;

  const add = vscode.l10n.t('pasteport.skipShell.addSetting');
  const never = vscode.l10n.t('pasteport.skipShell.dontAskAgain');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('pasteport.skipShell.prompt'),
    add,
    never
  );

  if (choice === never) {
    suppression.suppress();
    return;
  }
  if (choice !== add) return;

  // Append to the user-scoped value specifically: writing the effective value
  // back would silently promote a workspace or default entry into user settings.
  const inspected = section.inspect<string[]>(SKIP_SHELL_KEY);
  const base = inspected?.globalValue ?? configured ?? [];
  try {
    await section.update(
      SKIP_SHELL_KEY,
      [...base, PASTE_COMMAND],
      vscode.ConfigurationTarget.Global
    );
    log.info(`added ${PASTE_COMMAND} to ${SKIP_SHELL_SECTION}.${SKIP_SHELL_KEY}`);
  } catch (err) {
    log.error(`could not update ${SKIP_SHELL_KEY}: ${describeError(err)}`);
  }
}
