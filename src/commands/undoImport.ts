import * as vscode from 'vscode';
import { runUndoImportWizard } from '../ui/undoImportWizard';

export function registerUndoImportCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.undoImport', () => runUndoImportWizard()),
  );
}
