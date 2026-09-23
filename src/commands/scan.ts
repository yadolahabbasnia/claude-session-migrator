import * as vscode from 'vscode';
import { scanForProjects } from '../discovery/projectScanner';
import { getSuggestedScanDirectories } from '../utils/platform';
import { getScanMaxDepth } from '../utils/config';
import { withCancellableProgress } from '../ui/progress';
import { logger } from '../utils/logging';
import * as os from 'node:os';

export function registerScanCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMigrator.scan', () => runScanCommand()),
  );
}

async function runScanCommand(): Promise<void> {
  const workspaceRoots = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  const homeDir = os.homedir();
  const suggestions = getSuggestedScanDirectories(homeDir, process.platform);

  const items: vscode.QuickPickItem[] = [
    ...(workspaceRoots.length > 0
      ? [{ label: '$(root-folder) Scan current workspace', description: workspaceRoots.join(', ') }]
      : []),
    { label: '$(folder-opened) Scan a folder...', description: 'Browse for a folder' },
    ...suggestions.map((dir) => ({ label: `$(folder) ${dir}`, description: 'Suggested developer directory' })),
  ];

  const choice = await vscode.window.showQuickPick(items, {
    title: 'Claude Migrator: Scan for Claude Projects',
    ignoreFocusOut: true,
  });
  if (!choice) {
    return;
  }

  let roots: string[];
  if (choice.label.includes('Scan current workspace')) {
    roots = workspaceRoots;
  } else if (choice.label.includes('Scan a folder')) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Select a folder to scan',
    });
    if (!picked || picked.length === 0) {
      return;
    }
    roots = [picked[0].fsPath];
  } else {
    roots = [choice.label.replace('$(folder) ', '')];
  }

  const projects = await withCancellableProgress('Scanning for Claude projects...', async (reporter) => {
    return scanForProjects(roots, {
      maxDepth: getScanMaxDepth(),
      isCancelled: () => reporter.isCancelled(),
      onProgress: (info) => reporter.report(`${info.currentPath} (${info.found} found)`),
    });
  });

  logger.info('Scan complete', { roots, found: projects.length });

  if (projects.length === 0) {
    vscode.window.showInformationMessage('No Claude projects found.');
    return;
  }

  const resultItems: vscode.QuickPickItem[] = projects.map((p) => ({
    label: `$(folder) ${p.name}`,
    description: `${p.claudeFileCount} files, ${Math.round(p.claudeSizeBytes / 1024)} KB`,
    detail: p.sourcePath,
  }));
  const selected = await vscode.window.showQuickPick(resultItems, {
    title: `Found ${projects.length} Claude project(s) -- select one to reveal it`,
    ignoreFocusOut: true,
  });
  if (selected?.detail) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(selected.detail));
  }
}
