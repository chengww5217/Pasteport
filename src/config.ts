import * as vscode from 'vscode';

import { describeError, type Logger } from './log';
import type { QuotingMode } from './quoting';
import { DEFAULT_REMOTE_DIR, normalizeRemoteDir } from './remote/paths';

/**
 * Settings, read fresh on every paste so a change takes effect immediately
 * without a reload and without a change listener to keep in sync.
 */
export interface PasteportConfig {
  remoteDir: string;
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
 * An unusable remoteDir falls back to the default rather than failing the
 * paste: the user gets their file across, plus a log line explaining where it
 * went and why.
 */
function readRemoteDir(section: vscode.WorkspaceConfiguration, log: Logger): string {
  const configured = section.get<string>('remoteDir', DEFAULT_REMOTE_DIR);
  try {
    return normalizeRemoteDir(configured);
  } catch (err) {
    log.warn(
      `pasteport.remoteDir is unusable (${describeError(err)}); falling back to ${DEFAULT_REMOTE_DIR}`
    );
    return DEFAULT_REMOTE_DIR;
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
