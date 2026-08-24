import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { contentFingerprint, metadataFingerprint, shouldHashContent } from '../fingerprint';
import { formatBytes, formatSeconds } from '../format';
import { describeError, type Logger } from '../log';
import { remoteDirForFingerprint, remoteFilePath } from './paths';
import { MIN_SAMPLE_BYTES, RateEstimator } from './rate';
import { remoteUri } from './target';

/** How often the progress message refreshes while one file is in flight. */
const TICK_MS = 500;

export interface SourceFile {
  /** Absolute local path. */
  localPath: string;
  /** File name to use on the remote side. */
  remoteName: string;
  size: number;
  mtimeMs: number;
  /**
   * Forces a content hash regardless of size.
   *
   * Set for staged clipboard images: the reader writes a new file with a new
   * mtime on every read, so a metadata key would be unique every time and the
   * same screenshot would upload again on every paste.
   */
  hashContent?: boolean;
}

export interface TransferOptions {
  /** Any remote URI from this window; supplies scheme and authority. */
  template: vscode.Uri;
  remoteDir: string;
  /** Estimated seconds above which the user is asked first; 0 disables. */
  confirmAboveSeconds: number;
}

export type TransferOutcome =
  | { status: 'done'; remotePaths: string[]; uploadedBytes: number; reused: number }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

/** Persistence hook for the rate estimate, backed by globalState in the extension. */
export interface RateStore {
  read(): number | undefined;
  write(bytesPerSecond: number): void;
}

interface PlannedFile {
  source: SourceFile;
  remotePath: string;
  fileUri: vscode.Uri;
  dirUri: vscode.Uri;
  needsUpload: boolean;
}

export class TransferService {
  private readonly estimator: RateEstimator;
  private active: vscode.CancellationTokenSource | undefined;

  constructor(
    private readonly log: Logger,
    private readonly store: RateStore
  ) {
    this.estimator = new RateEstimator(store.read());
  }

  /** Current throughput estimate, for the diagnostics command. */
  get rateBytesPerSecond(): number {
    return this.estimator.bytesPerSecond;
  }

  /**
   * Aborts the transfer in flight, if any.
   *
   * Needed as an explicit command because the fast path shows status-bar
   * progress, which by design has no cancel button.
   *
   * @returns whether there was anything to cancel.
   */
  cancelActive(): boolean {
    if (this.active === undefined) return false;
    this.log.info('transfer cancelled by user');
    this.active.cancel();
    return true;
  }

  async transfer(files: readonly SourceFile[], options: TransferOptions): Promise<TransferOutcome> {
    if (files.length === 0) return { status: 'done', remotePaths: [], uploadedBytes: 0, reused: 0 };

    const cts = new vscode.CancellationTokenSource();
    this.active = cts;
    try {
      return await this.run(files, options, cts);
    } finally {
      this.active = undefined;
      cts.dispose();
    }
  }

  private async run(
    files: readonly SourceFile[],
    options: TransferOptions,
    cts: vscode.CancellationTokenSource
  ): Promise<TransferOutcome> {
    let planned: PlannedFile[];
    try {
      planned = await this.plan(files, options);
    } catch (err) {
      return { status: 'failed', message: describeFsError(err) };
    }

    if (cts.token.isCancellationRequested) return { status: 'cancelled' };

    const pending = planned.filter((entry) => entry.needsUpload);
    const reused = planned.length - pending.length;
    const pendingBytes = pending.reduce((sum, entry) => sum + entry.source.size, 0);

    if (pending.length === 0) {
      this.log.info(`all ${planned.length} file(s) already present remotely, nothing to transfer`);
      return {
        status: 'done',
        remotePaths: planned.map((e) => e.remotePath),
        uploadedBytes: 0,
        reused,
      };
    }

    // One estimate drives both decisions: whether to ask, and how to show
    // progress. A separate threshold for each would be a second thing to tune
    // and a second thing to get inconsistent.
    const estimatedSeconds = this.estimator.estimateSeconds(pendingBytes);
    const needsConfirmation =
      options.confirmAboveSeconds > 0 && estimatedSeconds > options.confirmAboveSeconds;

    if (needsConfirmation && !(await confirmSlowTransfer(pendingBytes, estimatedSeconds))) {
      this.log.info(
        `transfer declined at confirmation: ${formatBytes(pendingBytes)}, ` +
          `estimated ${formatSeconds(estimatedSeconds)}`
      );
      return { status: 'cancelled' };
    }

    return this.upload(planned, pending, pendingBytes, reused, needsConfirmation, cts);
  }

  /**
   * Works out every target path and which files actually have to move.
   *
   * The dedup probe is a `stat`: a hit costs one round trip and saves the
   * entire payload, which on a 3.5 MB/s link is the difference between
   * instant and tens of seconds.
   */
  private async plan(
    files: readonly SourceFile[],
    options: TransferOptions
  ): Promise<PlannedFile[]> {
    const planned: PlannedFile[] = [];

    for (const source of files) {
      const fingerprint = await this.fingerprint(source);
      const remotePath = remoteFilePath(options.remoteDir, fingerprint, source.remoteName);
      const fileUri = remoteUri(options.template, remotePath);
      const dirUri = remoteUri(
        options.template,
        remoteDirForFingerprint(options.remoteDir, fingerprint)
      );

      planned.push({
        source,
        remotePath,
        fileUri,
        dirUri,
        needsUpload: !(await this.alreadyThere(fileUri, source.size)),
      });
    }

    return planned;
  }

  private async fingerprint(source: SourceFile): Promise<string> {
    if (source.hashContent === true || shouldHashContent(source.size)) {
      // Read twice (here, and again to upload) rather than holding the bytes:
      // local reads run at ~800 MB/s, and a multi-file paste would otherwise
      // pin every payload in the extension host at once.
      return contentFingerprint(await fs.readFile(source.localPath));
    }
    return metadataFingerprint({
      size: source.size,
      mtimeMs: source.mtimeMs,
      name: path.basename(source.localPath),
    });
  }

  /** A size mismatch means a previous transfer was interrupted; redo it. */
  private async alreadyThere(fileUri: vscode.Uri, size: number): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.size === size) {
        this.log.debug(`reusing remote copy: ${fileUri.path}`);
        return true;
      }
      this.log.info(`remote copy has size ${stat.size}, expected ${size}; re-uploading`);
      return false;
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') return false;
      // Anything else (permissions, connection) will resurface on write, where
      // it can be reported properly.
      this.log.debug(`stat failed for ${fileUri.path}: ${describeError(err)}`);
      return false;
    }
  }

  private async upload(
    planned: readonly PlannedFile[],
    pending: readonly PlannedFile[],
    pendingBytes: number,
    reused: number,
    confirmed: boolean,
    cts: vscode.CancellationTokenSource
  ): Promise<TransferOutcome> {
    // Status bar unless the user has already been told this will be slow. It
    // sits outside their field of view (they are watching the terminal), so
    // showing it from the first millisecond costs nothing and needs no
    // delay/minimum-duration dance. Once a confirmation has been shown, a
    // notification is no longer a surprise and cancellation becomes worth
    // offering.
    const location = confirmed
      ? vscode.ProgressLocation.Notification
      : vscode.ProgressLocation.Window;

    return vscode.window.withProgress(
      { location, title: 'Pasteport', cancellable: confirmed },
      async (progress, progressToken): Promise<TransferOutcome> => {
        const link = progressToken.onCancellationRequested(() => cts.cancel());
        let uploadedBytes = 0;

        try {
          for (const entry of pending) {
            // writeFile cannot be interrupted, so a cancellation always lands
            // between files: whatever is already up is complete and will either
            // be reused by a later paste or aged out, and only a genuine
            // failure can leave a half-written file behind.
            if (cts.token.isCancellationRequested) return { status: 'cancelled' };

            const { source } = entry;
            const stopTicker = startTicker(progress, source, this.estimator);
            let writeMs = 0;

            try {
              await vscode.workspace.fs.createDirectory(entry.dirUri);

              const bytes = await fs.readFile(source.localPath);
              // Timed around writeFile alone: including the createDirectory
              // round trip would bias the rate estimate low and make ordinary
              // pastes trip the confirmation threshold.
              const started = Date.now();
              await vscode.workspace.fs.writeFile(entry.fileUri, bytes);
              writeMs = Date.now() - started;
            } catch (err) {
              // Remove the truncated file only. The fingerprint directory can
              // hold an earlier, still-referenced paste; an empty one is
              // harmless and the TTL sweeper will collect it.
              await this.discard(entry.fileUri);
              return { status: 'failed', message: describeFsError(err) };
            } finally {
              stopTicker();
            }

            uploadedBytes += source.size;
            this.recordSample(source.size, writeMs);
            this.log.info(
              `uploaded ${formatBytes(source.size)} in ${writeMs}ms -> ${entry.remotePath}`
            );

            // Percentage only shows up in the notification, but reporting it
            // unconditionally keeps one code path. Files of zero length carry no
            // weight, so fall back to counting them evenly.
            progress.report({
              increment:
                pendingBytes > 0 ? (source.size / pendingBytes) * 100 : 100 / pending.length,
            });
          }
        } finally {
          link.dispose();
        }

        // The loop can only observe cancellation before a write starts, so a
        // cancel arriving during the last (often only) file would otherwise be
        // dropped here and the path injected anyway.
        if (cts.token.isCancellationRequested) return { status: 'cancelled' };

        return {
          status: 'done',
          remotePaths: planned.map((entry) => entry.remotePath),
          uploadedBytes,
          reused,
        };
      }
    );
  }

  private recordSample(bytes: number, elapsedMs: number): void {
    if (!this.estimator.observe(bytes, elapsedMs)) {
      // Either too small to say anything about bandwidth, or so fast that the
      // millisecond clock reported zero — both are uninformative.
      this.log.trace(
        `rate sample ignored: ${bytes} bytes in ${elapsedMs}ms ` +
          `(needs >= ${MIN_SAMPLE_BYTES} bytes and > 0ms)`
      );
      return;
    }
    this.store.write(this.estimator.bytesPerSecond);
    this.log.debug(`transfer rate estimate now ${formatBytes(this.estimator.bytesPerSecond)}/s`);
  }

  /**
   * Removes a file whose write failed part-way.
   *
   * A truncated payload is worse than a missing one: an agent reading it gets
   * plausible-looking garbage instead of an error.
   */
  private async discard(file: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(file, { recursive: false, useTrash: false });
    } catch (err) {
      this.log.debug(`could not clean up ${file.path}: ${describeError(err)}`);
    }
  }
}

/**
 * Keeps the progress message moving while a single `writeFile` is in flight.
 *
 * There is no byte-level callback to hook into, and inventing a percentage
 * would be a lie. Elapsed time against the estimate answers the only question
 * this UI exists to answer: is it stuck?
 */
function startTicker(
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  source: SourceFile,
  estimator: RateEstimator
): () => void {
  const started = Date.now();
  const estimate = estimator.estimateSeconds(source.size);

  const render = (): void => {
    const elapsed = (Date.now() - started) / 1000;
    const remaining = Math.max(0, estimate - elapsed);
    progress.report({
      message:
        `${source.remoteName} (${formatBytes(source.size)}) — ` +
        `${formatSeconds(elapsed)} elapsed, ~${formatSeconds(remaining)} left`,
    });
  };

  render();
  const timer = setInterval(render, TICK_MS);
  return () => clearInterval(timer);
}

async function confirmSlowTransfer(bytes: number, seconds: number): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Send ${formatBytes(bytes)} to the remote host?`,
    { modal: true, detail: `Estimated ${formatSeconds(seconds)} at the last measured speed.` },
    'Send'
  );
  return choice === 'Send';
}

function describeFsError(err: unknown): string {
  if (err instanceof vscode.FileSystemError) {
    switch (err.code) {
      case 'NoPermissions':
        return 'the remote directory is not writable — check pasteport.remoteDir';
      case 'Unavailable':
        return 'the remote connection is unavailable — reconnect the window and try again';
      default:
        return `remote write failed (${err.code}): ${err.message}`;
    }
  }
  return describeError(err);
}
