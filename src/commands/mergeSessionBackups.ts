import * as vscode from 'vscode';
import { runMergeSessionBackupsWizard } from '../ui/mergeSessionBackupsWizard';

export function registerMergeSessionBackupsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.mergeSessionBackups', () => runMergeSessionBackupsWizard()),
  );
}
