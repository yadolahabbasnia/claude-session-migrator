import * as vscode from 'vscode';
import { runExportWizard, exportSingleFolder } from '../ui/exportWizard';

export function registerExportCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.export', () => runExportWizard()),
    vscode.commands.registerCommand('claudeMigrator.exportFolder', (uri?: vscode.Uri) => {
      const folder = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!folder) {
        vscode.window.showWarningMessage('Claude Migrator: no folder selected.');
        return;
      }
      return exportSingleFolder(folder);
    }),
  );
}
