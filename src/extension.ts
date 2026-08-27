import * as vscode from 'vscode';

import { createClipboardReader, STAGING_DIR, type ClipboardReader } from './clipboard';
import { readConfig } from './config';
import { formatBytes } from './format';
import { describeError, type Logger } from './log';
import { paste } from './paste';
import { sweepRemote, sweepStaging } from './remote/sweeper';
import { RemoteDirResolver } from './remote/remoteDir';
import { isWritableRemote, remoteTemplateUri } from './remote/target';
import { TransferService, type RateStore } from './remote/transfer';
import { ensurePasteKeyReachesExtension, type PromptSuppression } from './skipShell';

/** Where the measured throughput survives a window reload. */
const RATE_KEY = 'pasteport.rateBytesPerSecond';

/** Set once the user declines the commandsToSkipShell prompt for good. */
const SKIP_SHELL_PROMPT_KEY = 'pasteport.skipShellPromptDismissed';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Pasteport', { log: true });
  context.subscriptions.push(log);

  // The reader is a local script run by a local interpreter, so the extension
  // itself has to be installed locally. If VS Code ever hands a ui-kind
  // extension a non-file location, spawning would silently target nothing —
  // better to degrade to a pass-through and say so.
  const reader =
    context.extensionUri.scheme === 'file'
      ? createClipboardReader({ extensionPath: context.extensionUri.fsPath, log })
      : undefined;
  if (reader === undefined && context.extensionUri.scheme !== 'file') {
    log.error(
      `extension is not installed locally (${context.extensionUri.scheme}); pastes will pass through`
    );
  }

  const transfer = new TransferService(log, rateStore(context));
  const remoteDirs = new RemoteDirResolver(log);
  let pasteInFlight = false;

  context.subscriptions.push(
    vscode.commands.registerCommand('pasteport.paste', async () => {
      // A second Cmd+V while the first transfer is still running would inject
      // two paths in an unpredictable order; the press is dropped, with a log
      // line rather than a dialog.
      if (pasteInFlight) {
        log.debug('paste already in progress, ignoring this one');
        return;
      }
      pasteInFlight = true;
      try {
        await paste({
          reader,
          transfer,
          readConfig: () => readConfig(log),
          resolveRemoteDir: (template, configured) => remoteDirs.resolve(template, configured),
          log,
        });
      } catch (err) {
        log.error(`unexpected paste failure: ${describeError(err)}`);
      } finally {
        pasteInFlight = false;
      }
    }),

    vscode.commands.registerCommand('pasteport.cancelTransfer', () => {
      if (!transfer.cancelActive()) {
        void vscode.window.showInformationMessage('Pasteport: no transfer in progress.');
      }
    }),

    vscode.commands.registerCommand('pasteport.cleanUpRemoteFiles', () =>
      cleanUp(log, remoteDirs, true)
    ),

    vscode.commands.registerCommand('pasteport.diagnose', () =>
      diagnose(log, reader, transfer, remoteDirs)
    )
  );

  log.info(`Pasteport activated on ${process.platform}, VS Code ${vscode.version}`);

  // Cleanup is best-effort background work: it must never delay a paste, and a
  // failure here is not worth a dialog. It also warms the remote directory
  // resolver, so the first paste of a session does not pay for detection.
  void cleanUp(log, remoteDirs, false);

  // On Windows and Linux the keybinding is only useful if the command is allowed
  // to skip the shell. Nothing to check when no reader exists: the command would
  // pass the paste through anyway.
  if (reader !== undefined) {
    void ensurePasteKeyReachesExtension(log, skipShellPromptSuppression(context));
  }
}

export function deactivate(): void {
  /* everything is registered through context.subscriptions */
}

function rateStore(context: vscode.ExtensionContext): RateStore {
  return {
    read: () => context.globalState.get<number>(RATE_KEY),
    write: (bytesPerSecond) => {
      void context.globalState.update(RATE_KEY, bytesPerSecond);
    },
  };
}

/** Remembers "don't ask again" for the commandsToSkipShell prompt. */
function skipShellPromptSuppression(context: vscode.ExtensionContext): PromptSuppression {
  return {
    isSuppressed: () => context.globalState.get<boolean>(SKIP_SHELL_PROMPT_KEY) === true,
    suppress: () => {
      void context.globalState.update(SKIP_SHELL_PROMPT_KEY, true);
    },
  };
}

/**
 * TTL sweep of both ends.
 *
 * @param interactive whether to report the result to the user.
 */
async function cleanUp(
  log: Logger,
  remoteDirs: RemoteDirResolver,
  interactive: boolean
): Promise<void> {
  const config = readConfig(log);
  const template = remoteTemplateUri();

  const staging = await sweepStaging({ stagingDir: STAGING_DIR, ttlHours: config.ttlHours, log });

  if (template === undefined) {
    if (interactive) {
      void vscode.window.showInformationMessage(
        `Pasteport: removed ${staging.removed} staged file(s) locally. ` +
          'No remote target could be resolved in this window, so nothing was swept remotely.'
      );
    }
    return;
  }

  const remote = await sweepRemote({
    template,
    remoteDir: await remoteDirs.resolve(template, config.remoteDir),
    ttlHours: config.ttlHours,
    log,
  });

  if (interactive) {
    void vscode.window.showInformationMessage(
      `Pasteport: removed ${remote.removed} remote and ${staging.removed} local item(s) ` +
        `older than ${config.ttlHours}h.`
    );
  }
}

/**
 * Prints the environment this extension's assumptions depend on.
 *
 * Every line here is something that has to be true for a paste to work, so a
 * bug report can start from evidence instead of guesswork.
 */
async function diagnose(
  log: Logger,
  reader: ClipboardReader | undefined,
  transfer: TransferService,
  remoteDirs: RemoteDirResolver
): Promise<void> {
  log.show(true);
  log.info('--- Pasteport diagnostics ---');
  log.info(`extension host platform : ${process.platform} (must be the client OS)`);
  log.info(`node                    : ${process.version}`);
  log.info(`vscode                  : ${vscode.version}`);
  log.info(`env.remoteName          : ${vscode.env.remoteName ?? '(none - local window)'}`);
  log.info(`env.uiKind              : ${vscode.UIKind[vscode.env.uiKind]}`);
  log.info(
    `clipboard reader        : ${reader === undefined ? 'none for this platform' : 'available'}`
  );
  log.info(`staging dir             : ${STAGING_DIR}`);

  const config = readConfig(log);
  log.info(
    `config                  : remoteDir=${config.remoteDir ?? '(auto)'} ` +
      `quoting=${config.quoting} trailingSpace=${config.trailingSpace} ` +
      `confirmAboveSeconds=${config.confirmAboveSeconds} ` +
      `ttlHours=${config.ttlHours} bracketedPaste=${config.bracketedPaste}`
  );

  const template = remoteTemplateUri();
  if (template === undefined) {
    log.warn('no remote URI in this window: pastes here fall through to the terminal unchanged');
  } else {
    log.info(`remote template         : ${template.scheme}://${template.authority}`);
    log.info(`isWritableFileSystem    : ${String(isWritableRemote(template))}`);
    log.info(`resolved remote dir     : ${await remoteDirs.resolve(template, config.remoteDir)}`);
  }

  if (reader === undefined) return;

  const started = Date.now();
  const content = await reader.read();
  const elapsed = Date.now() - started;
  switch (content.kind) {
    case 'files':
    case 'image':
      log.info(`clipboard read (${elapsed}ms) : ${content.kind} -> ${content.paths.join(', ')}`);
      break;
    case 'other':
      log.info(`clipboard read (${elapsed}ms) : other -> ${content.types.join(', ') || '(empty)'}`);
      break;
    case 'error':
      log.error(`clipboard read (${elapsed}ms) : ${content.message}`);
      break;
  }

  log.info(`rate estimate           : ${formatBytes(transfer.rateBytesPerSecond)}/s`);
  log.info('--- end diagnostics ---');
}
