import * as vscode from 'vscode';
import { validateArchive } from '../validation/validator';
import { withCancellableProgress } from '../ui/progress';
import { logger } from '../utils/logging';

export function registerInspectCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.inspect', () => runInspectCommand()),
  );
}

async function runInspectCommand(): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Claude Migration Transfer': ['cmt'] },
    title: 'Select a .cmt archive to inspect',
  });
  const archiveFile = uris?.[0]?.fsPath;
  if (!archiveFile) {
    return;
  }

  const result = await withCancellableProgress('Validating archive...', async (reporter) => {
    return validateArchive(archiveFile, {
      onProgress: (label, p) => reporter.report(`${label}: ${p.processed}/${p.total} file(s)`),
    });
  });
  if (!result.ok || !result.archive) {
    vscode.window.showErrorMessage(`Archive is invalid:\n${result.errors.join('\n')}`, { modal: true });
    return;
  }

  const { manifest } = result.archive;
  const lines = [
    `Format version: ${manifest.formatVersion}`,
    `Created: ${manifest.createdAt}`,
    `Tool version: ${manifest.toolVersion}`,
    `Source platform: ${manifest.source.platform} (${manifest.source.architecture})`,
    `Checksums: ${result.errors.length === 0 ? 'all verified' : 'FAILED'}`,
    '',
    `Projects (${manifest.projects.length}):`,
    ...manifest.projects.map(
      (p) =>
        `  - ${p.name} (${p.fileCount} files, ${Math.round(p.sizeBytes / 1024)} KB)` +
        (p.git?.remoteUrls?.length ? ` -- ${p.git.remoteUrls[0]}` : '') +
        (p.excludedFiles.length > 0 ? ` [${p.excludedFiles.length} file(s) excluded at export time]` : ''),
    ),
    '',
    `Claude Code sessions (${manifest.sessionProjects.length}):`,
    ...manifest.sessionProjects.map(
      (s) =>
        `  - ${s.sourcePath ?? '(unknown source -- was ' + s.folderName + ')'} ` +
        `(${s.sessionCount} session(s), ${Math.round(s.sizeBytes / 1024)} KB)` +
        (s.git?.remoteUrls?.length ? ` -- ${s.git.remoteUrls[0]}` : '') +
        (s.hasMemoryDir ? ' [memory]' : '') +
        (s.excludedFiles.length > 0 ? ` [${s.excludedFiles.length} file(s) excluded at export time]` : ''),
    ),
  ];

  logger.info('Inspected archive', { archiveFile, projects: manifest.projects.length });
  vscode.window.showInformationMessage(`Inspecting ${archiveFile}`, {
    modal: true,
    detail: lines.join('\n'),
  });
}
