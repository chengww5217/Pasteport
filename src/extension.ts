import * as vscode from 'vscode';

let log: vscode.LogOutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('Pasteport', { log: true });
  context.subscriptions.push(log);
  log.info('Pasteport activated');
}

export function deactivate(): void {
  /* nothing to tear down beyond context.subscriptions */
}
