import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { pathExists, walkFiles, looksBinary } from '../utils/filesystem';
import { scanTextForSecrets } from '../security/secretScanner';
import { runHealthCheck } from '../validation/healthCheck';
import { toPortableRelativePath } from '../utils/paths';
import { logger } from '../utils/logging';

export function registerValidateCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.validate', () => runValidateCommand()),
  );
}

async function runValidateCommand(): Promise<void> {
  const folder = await pickProjectFolder();
  if (!folder) {
    return;
  }

  const claudeDir = path.join(folder, '.claude');
  if (!(await pathExists(claudeDir))) {
    vscode.window.showWarningMessage(`No .claude directory found in ${folder}.`);
    return;
  }

  let fileCount = 0;
  let secretFindings = 0;
  for await (const file of walkFiles(claudeDir)) {
    fileCount += 1;
    const buffer = await fs.readFile(file.absolutePath);
    if (looksBinary(buffer)) {
      continue;
    }
    const findings = scanTextForSecrets(toPortableRelativePath(file.relativePath), buffer.toString('utf8'));
    secretFindings += findings.length;
  }

  const health = await runHealthCheck({ destinationContentDir: claudeDir, expectedFileCount: fileCount });

  const lines = [
    ...health.items.map((i) => `${icon(i.status)} ${i.message}`),
    secretFindings === 0
      ? '✓ No obvious secrets detected.'
      : `⚠ ${secretFindings} potential secret(s) detected -- review before sharing this project.`,
  ];

  logger.info('Validated project', { folder, fileCount, secretFindings });
  vscode.window.showInformationMessage(`Validation results for ${path.basename(folder)}`, {
    modal: true,
    detail: lines.join('\n'),
  });
}

function icon(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
}

async function pickProjectFolder(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Select a project folder to validate',
    });
    return picked?.[0]?.fsPath;
  }
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }
  const choice = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, detail: f.uri.fsPath })),
    { title: 'Select a workspace folder to validate' },
  );
  return choice?.detail;
}
