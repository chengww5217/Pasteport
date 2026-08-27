import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { ClipboardContent, ClipboardReader } from './clipboard';
import type { ClipboardError } from './clipboard/types';
import type { PasteportConfig } from './config';
import { formatBytes } from './format';
import { offerPackageInstall } from './install';
import { describeError, type Logger } from './log';
import { formatPathsForTerminal } from './quoting';
import { isWritableRemote, remoteTemplateUri } from './remote/target';
import type { SourceFile, TransferService } from './remote/transfer';
import { injectText, passThroughPaste } from './terminal';

/**
 * The one place with business branching. Every branch that is not "we have
 * files to send" ends in the native paste, because Cmd+V is bound
 * unconditionally and an unhandled clipboard must behave as if this extension
 * were not installed.
 */

export interface PasteDependencies {
  /** Undefined on platforms without a reader yet; that is a pass-through. */
  reader: ClipboardReader | undefined;
  transfer: TransferService;
  readConfig: () => PasteportConfig;
  /** Turns the setting into a directory, detecting one when it is unset. */
  resolveRemoteDir: (template: vscode.Uri, configured: string | undefined) => Promise<string>;
  log: Logger;
}

export async function paste(deps: PasteDependencies): Promise<void> {
  const { log } = deps;

  // First, and before touching the clipboard: in a local window there is
  // nothing to transfer and reading the pasteboard would be pure latency on
  // every Cmd+V.
  const template = remoteTemplateUri();
  if (template === undefined) {
    if (vscode.env.remoteName === undefined) {
      log.trace('local window, passing the paste through');
    } else {
      // Attached to a remote host, but with nothing open there to borrow a URI
      // from. Logged rather than shown: Cmd+V must not raise dialogs.
      log.warn(
        `remote window (${vscode.env.remoteName}) has no remote folder or file open, ` +
          'so there is no URI to build a target from; passing the paste through'
      );
    }
    return passThroughPaste(log);
  }

  if (deps.reader === undefined) {
    log.debug(`no clipboard reader for platform ${process.platform}, passing the paste through`);
    return passThroughPaste(log);
  }

  const content = await deps.reader.read();
  const payload = describePayload(content);
  if (payload === undefined) {
    log.debug(`nothing to transfer (${summarize(content)}), passing the paste through`);
    if (content.kind === 'error' && content.actionable === true) {
      notifyActionableOnce(content, log);
    }
    return passThroughPaste(log);
  }

  if (!isWritableRemote(template)) {
    log.error(`remote file system "${template.scheme}" is not writable; cannot transfer`);
    showFailure(`Pasteport: the remote file system (${template.scheme}) is not writable.`, log);
    return;
  }

  // Reachable only from the command palette — the keybinding requires terminal
  // focus. Checked before the transfer rather than after: uploading bytes and
  // then finding nowhere to put the path would report success and leave the user
  // with nothing.
  if (vscode.window.terminals.length === 0) {
    log.warn('no terminal is open, nothing to insert into');
    void vscode.window.showInformationMessage('Pasteport: open a terminal first.');
    return;
  }

  const config = deps.readConfig();
  const remoteDir = await deps.resolveRemoteDir(template, config.remoteDir);

  let sources: SourceFile[];
  try {
    sources = await describeSources(payload.paths, payload.kind);
  } catch (err) {
    log.error(`could not read the clipboard files: ${describeError(err)}`);
    showFailure('Pasteport: could not read the files from the clipboard.', log);
    return;
  }

  const total = sources.reduce((sum, file) => sum + file.size, 0);
  log.info(
    `sending ${sources.length} ${payload.kind === 'image' ? 'image' : 'file'}(s), ` +
      `${formatBytes(total)} total, to ${template.authority}:${remoteDir}`
  );

  const outcome = await deps.transfer.transfer(sources, {
    template,
    remoteDir,
    confirmAboveSeconds: config.confirmAboveSeconds,
  });

  switch (outcome.status) {
    case 'cancelled':
      log.info('transfer cancelled, nothing injected');
      return;

    case 'failed':
      log.error(`transfer failed: ${outcome.message}`);
      showFailure(`Pasteport: ${outcome.message}`, log);
      return;

    case 'done': {
      const paths = unique(outcome.remotePaths);
      log.info(
        `transferred ${formatBytes(outcome.uploadedBytes)}, reused ${outcome.reused} ` +
          `existing copy(ies); injecting ${paths.length} path(s)`
      );

      const text = formatPathsForTerminal(paths, {
        mode: config.quoting,
        trailingSpace: config.trailingSpace,
      });
      const injected = await injectText(text, {
        bracketedPaste: config.bracketedPaste,
        log,
      });
      if (!injected) {
        showFailure('Pasteport: files were transferred but the path could not be inserted.', log);
      }
      return;
    }
  }
}

interface Payload {
  kind: 'files' | 'image';
  paths: string[];
}

function describePayload(content: ClipboardContent): Payload | undefined {
  switch (content.kind) {
    case 'files':
    case 'image':
      return { kind: content.kind, paths: content.paths };
    case 'other':
    case 'error':
      return undefined;
  }
}

function summarize(content: ClipboardContent): string {
  switch (content.kind) {
    case 'other':
      return content.types.length === 0
        ? 'empty clipboard'
        : `clipboard types: ${content.types.join(', ')}`;
    case 'error':
      return `reader error: ${content.message}`;
    default:
      return content.kind;
  }
}

async function describeSources(
  paths: readonly string[],
  kind: 'files' | 'image'
): Promise<SourceFile[]> {
  const sources: SourceFile[] = [];

  for (const [index, localPath] of paths.entries()) {
    const stat = await fs.stat(localPath);
    sources.push({
      localPath,
      remoteName:
        kind === 'image'
          ? stagedImageName(localPath, index, paths.length)
          : path.basename(localPath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      // A staged image is written fresh on every clipboard read, so its
      // metadata is never stable — only its contents identify it.
      hashContent: kind === 'image',
    });
  }

  return sources;
}

/**
 * Staged images get a stable remote name rather than the timestamp the reader
 * used locally.
 *
 * The fingerprint directory already guarantees uniqueness, so a timestamp in
 * the name would only defeat deduplication: pasting the same screenshot twice
 * would otherwise write it again under a second name.
 */
function stagedImageName(localPath: string, index: number, count: number): string {
  const extension = path.extname(localPath) || '.png';
  return count === 1 ? `clipboard${extension}` : `clipboard-${index + 1}${extension}`;
}

/** Identical files copied together resolve to one remote path; mention it once. */
function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/**
 * Reader problems the user can fix — a missing Linux clipboard tool — are worth
 * saying out loud, because the alternative is a key that appears to do nothing.
 * Shown once per session per message, so holding the key down cannot spam it.
 */
const notifiedActionable = new Set<string>();

function notifyActionableOnce(error: ClipboardError, log: Logger): void {
  if (notifiedActionable.has(error.message)) return;
  notifiedActionable.add(error.message);

  // A problem with a known fix gets the fix offered; everything else gets the
  // log, which is all we can honestly do about it.
  if (error.remedy?.kind === 'installPackages') {
    void offerPackageInstall(error.remedy.packages, error.message, log);
    return;
  }

  void vscode.window
    .showWarningMessage(`Pasteport: ${error.message}`, 'Show Log')
    .then((choice) => {
      if (choice === 'Show Log') log.show(true);
    });
}

function showFailure(message: string, log: Logger): void {
  void vscode.window.showErrorMessage(message, 'Show Log').then((choice) => {
    if (choice === 'Show Log') log.show(true);
  });
}
