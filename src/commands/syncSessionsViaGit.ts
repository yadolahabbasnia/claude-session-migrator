import * as vscode from 'vscode';
import { runConfigureGitSyncRepo, runGitSyncWizard, useLocalSessionsOnly } from '../ui/gitSyncWizard';

export function registerSyncSessionsViaGitCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.syncSessionsViaGit', () => runGitSyncWizard()),
    vscode.commands.registerCommand('claudeMigrator.configureGitSyncRepo', () => runConfigureGitSyncRepo()),
    vscode.commands.registerCommand('claudeMigrator.useLocalSessionsOnly', () => useLocalSessionsOnly()),
  );
}
