import * as vscode from 'vscode';
import { runSessionImportWizard } from '../ui/sessionImportWizard';

export function registerImportSessionsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.importSessions', () => runSessionImportWizard()),
  );
}
