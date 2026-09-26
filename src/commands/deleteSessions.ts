import * as vscode from 'vscode';
import { runSessionDeleteWizard } from '../ui/sessionDeleteWizard';

export function registerDeleteSessionsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.deleteSessions', () => runSessionDeleteWizard()),
  );
}
