import * as vscode from 'vscode';

import { describeError, type Logger } from './log';
import type { QuotingMode } from './quoting';
import { normalizeRemoteDir } from './remote/paths';

/**
 * Settings, read fresh on every paste so a change takes effect immediately
 * without a reload and without a change listener to keep in sync.
 */
export interface PasteportConfig {
  /**
   * Undefined when the setting is empty, which means "detect the remote host's
   * temp directory"; see remote/tempDir.ts. Resolving it needs a remote round
   * trip, so it deliberately does not happen here.
   */
  remoteDir: string | undefined;
  quoting: QuotingMode;
  trailingSpace: boolean;
  confirmAboveSeconds: number;
  ttlHours: number;
  bracketedPaste: boolean;
}

const QUOTING_MODES: readonly QuotingMode[] = ['auto', 'shell', 'none'];

export function readConfig(log: Logger): PasteportConfig {
  const section = vscode.workspace.getConfiguration('pasteport');

  return {
    remoteDir: readRemoteDir(section, log),
    quoting: readQuoting(section, log),
    trailingSpace: section.get<boolean>('trailingSpace', true),
    confirmAboveSeconds: clampNonNegative(section.get<number>('confirmAboveSeconds', 5), 5),
    ttlHours: clampNonNegative(section.get<number>('ttlHours', 24), 24),
    bracketedPaste: section.get<boolean>('bracketedPaste', false),
  };
}

/**
 * An unset remoteDir is the default and means detection; an unusable one falls
 * back to detection too rather than failing the paste, so the user gets their
 * file across plus a log line explaining why the setting was ignored.
 */
function readRemoteDir(section: vscode.WorkspaceConfiguration, log: Logger): string | undefined {
  const configured = section.get<string>('remoteDir', '');
  if (configured.trim() === '') return undefined;

  try {
    return normalizeRemoteDir(configured);
  } catch (err) {
    log.warn(
      `pasteport.remoteDir is unusable (${describeError(err)}); ` +
        "detecting the remote host's temp directory instead"
    );
    return undefined;
  }
}

function readQuoting(section: vscode.WorkspaceConfiguration, log: Logger): QuotingMode {
  const configured = section.get<string>('quoting', 'auto');
  if ((QUOTING_MODES as readonly string[]).includes(configured)) return configured as QuotingMode;

  log.warn(`pasteport.quoting has unknown value ${JSON.stringify(configured)}; using "auto"`);
  return 'auto';
}

function clampNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}
