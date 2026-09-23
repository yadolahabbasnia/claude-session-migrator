import * as vscode from 'vscode';
import { runImportWizard } from '../ui/importWizard';

export function registerImportCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.import', () => runImportWizard()),
  );
}
