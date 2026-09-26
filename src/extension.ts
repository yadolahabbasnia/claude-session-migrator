import * as vscode from 'vscode';
import { registerExportCommands } from './commands/export';
import { registerImportCommand } from './commands/import';
import { registerScanCommand } from './commands/scan';
import { registerInspectCommand } from './commands/inspect';
import { registerValidateCommand } from './commands/validate';
import { registerExportSessionsCommand } from './commands/exportSessions';
import { registerImportSessionsCommand } from './commands/importSessions';
import { registerUndoImportCommand } from './commands/undoImport';
import { SessionsViewProvider } from './ui/sessionsViewProvider';
import { logger } from './utils/logging';
import { getDebugLoggingEnabled } from './utils/config';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Claude Migrator');
  context.subscriptions.push(outputChannel);

  logger.setSink({ append: (line) => outputChannel.appendLine(line) });
  logger.setDebugEnabled(getDebugLoggingEnabled());

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeMigrator.debugLogging')) {
        logger.setDebugEnabled(getDebugLoggingEnabled());
      }
    }),
  );

  registerExportCommands(context);
  registerImportCommand(context);
  registerScanCommand(context);
  registerInspectCommand(context);
  registerValidateCommand(context);
  registerExportSessionsCommand(context);
  registerImportSessionsCommand(context);
  registerUndoImportCommand(context);

  const sessionsViewProvider = new SessionsViewProvider(context.extensionUri);
  context.subscriptions.push(
    sessionsViewProvider,
    vscode.window.registerWebviewViewProvider(SessionsViewProvider.viewType, sessionsViewProvider),
  );

  logger.info('Claude Project Migrator activated');
}

export function deactivate(): void {
  logger.info('Claude Project Migrator deactivated');
}
