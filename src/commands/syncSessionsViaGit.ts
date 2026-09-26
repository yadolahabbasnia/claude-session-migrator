import * as vscode from 'vscode';
import { runGitSyncWizard } from '../ui/gitSyncWizard';

export function registerSyncSessionsViaGitCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.syncSessionsViaGit', () => runGitSyncWizard()),
  );
}
