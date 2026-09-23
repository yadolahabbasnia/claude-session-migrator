import * as vscode from 'vscode';
import { runSessionExportWizard } from '../ui/sessionExportWizard';

export function registerExportSessionsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.exportSessions', (projectId?: string) =>
      runSessionExportWizard(projectId),
    ),
  );
}
