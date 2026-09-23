import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanForProjects } from '../discovery/projectScanner';
import { getSuggestedScanDirectories } from '../utils/platform';
import { getScanMaxDepth } from '../utils/config';
import { pathExists } from '../utils/filesystem';
import { scanProjectReferences } from '../migration/referenceScanner';
import { createArchive, type ArchiveProjectInput } from '../archive/archiveWriter';
import type { DiscoveredProject } from '../models/project';
import { withCancellableProgress } from './progress';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';
import { runSecurityReview, pickArchiveDestinationFile, formatBytes } from './exportWizardShared';

export interface ExportOptions {
  portableMigration: boolean;
  securityScan: boolean;
  includeHostname: boolean;
  compress: boolean;
}

const DEFAULT_OPTIONS: ExportOptions = {
  portableMigration: true,
  securityScan: true,
  includeHostname: false,
  compress: true,
};

export async function runExportWizard(preselectedFolder?: vscode.Uri): Promise<void> {
  try {
    const roots = preselectedFolder
      ? [preselectedFolder.fsPath]
      : (vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []);

    let projects = await scanWithProgress(roots.length > 0 ? roots : await pickFolderToScan());
    if (projects.length === 0) {
      const additional = await offerBroaderScan();
      if (additional) {
        projects = await scanWithProgress(additional);
      }
    }

    if (projects.length === 0) {
      vscode.window.showInformationMessage(
        'No Claude projects (folders containing a .claude directory) were found.',
      );
      return;
    }

    const selected = await selectProjects(projects);
    if (!selected || selected.length === 0) {
      return;
    }

    const options = await chooseExportOptions();
    if (!options) {
      return;
    }

    const { excludedByTarget, placeholderByTarget, findingsCount } = options.securityScan
      ? await runSecurityReview(selected.map((p) => ({ id: p.id, label: p.name, rootPath: p.claudePath })))
      : { excludedByTarget: new Map(), placeholderByTarget: new Map(), findingsCount: 0 };

    const referenceCounts = options.portableMigration ? await countReferences(selected) : new Map();

    const proceed = await showReviewStep(selected, options, findingsCount, referenceCounts);
    if (!proceed) {
      return;
    }

    const destination = await pickArchiveDestinationFile('claude-migration');
    if (!destination) {
      return;
    }

    await withCancellableProgress('Exporting Claude projects...', async (reporter) => {
      reporter.report(`Archiving ${selected.length} project(s)...`);
      const inputs: ArchiveProjectInput[] = selected.map((project) => ({
        project,
        excludedRelativePaths: excludedByTarget.get(project.id),
        placeholderContent: placeholderByTarget.get(project.id),
      }));
      const result = await createArchive({
        destinationFile: destination,
        projects: inputs,
        includeHostname: options.includeHostname,
        compress: options.compress,
      });
      logger.info('Export complete', {
        destination,
        projects: selected.length,
        files: result.fileCount,
        bytes: result.archiveSizeBytes,
      });
    });

    const openFolder = 'Reveal in Explorer';
    const choice = await vscode.window.showInformationMessage(
      `Export complete: ${selected.length} project(s) written to ${path.basename(destination)}.`,
      openFolder,
    );
    if (choice === openFolder) {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(destination));
    }
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Export failed', { error: String(err) });
    vscode.window.showErrorMessage(`Claude Migrator: export failed -- ${(err as Error).message}`);
  }
}

async function pickFolderToScan(): Promise<string[]> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Scan this folder',
    title: 'Select a folder to scan for Claude projects',
  });
  return picked && picked.length > 0 ? [picked[0].fsPath] : [];
}

async function offerBroaderScan(): Promise<string[] | undefined> {
  const homeDir = os.homedir();
  const suggestions = getSuggestedScanDirectories(homeDir, process.platform);
  const items: vscode.QuickPickItem[] = [
    { label: '$(folder-opened) Choose a folder...', description: 'Browse for a folder to scan' },
    ...suggestions.map((dir) => ({ label: dir })),
  ];
  const choice = await vscode.window.showQuickPick(items, {
    title: 'No projects found in the current workspace. Scan somewhere else?',
    ignoreFocusOut: true,
  });
  if (!choice) {
    return undefined;
  }
  if (choice.label.startsWith('$(folder-opened)')) {
    return pickFolderToScan();
  }
  return [choice.label];
}

async function scanWithProgress(roots: string[]): Promise<DiscoveredProject[]> {
  if (roots.length === 0) {
    return [];
  }
  return withCancellableProgress('Scanning for Claude projects...', async (reporter) => {
    return scanForProjects(roots, {
      workspaceRoot: roots[0],
      maxDepth: getScanMaxDepth(),
      isCancelled: () => reporter.isCancelled(),
      onProgress: (info) => reporter.report(`Scanning ${info.currentPath}... (${info.found} found)`),
    });
  });
}

interface ProjectQuickPickItem extends vscode.QuickPickItem {
  project: DiscoveredProject;
}

async function selectProjects(projects: DiscoveredProject[]): Promise<DiscoveredProject[] | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<ProjectQuickPickItem>();
    quickPick.title = 'Select Claude projects to export';
    quickPick.canSelectMany = true;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = projects.map(toProjectItem);
    quickPick.selectedItems = quickPick.items;
    quickPick.buttons = [
      { iconPath: new vscode.ThemeIcon('check-all'), tooltip: 'Select all' },
      { iconPath: new vscode.ThemeIcon('close-all'), tooltip: 'Deselect all' },
    ];
    quickPick.onDidTriggerButton((button) => {
      quickPick.selectedItems = button.tooltip === 'Select all' ? quickPick.items : [];
    });
    let accepted = false;
    quickPick.onDidAccept(() => {
      accepted = true;
      resolve(quickPick.selectedItems.map((i) => i.project));
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      if (!accepted) {
        resolve(undefined);
      }
      quickPick.dispose();
    });
    quickPick.show();
  });
}

function toProjectItem(project: DiscoveredProject): ProjectQuickPickItem {
  const sizeKb = Math.max(1, Math.round(project.claudeSizeBytes / 1024));
  const gitInfo = project.git ? ` -- ${project.git.remoteUrls[0] ?? 'git repo'}` : '';
  return {
    project,
    label: `$(folder) ${project.name}`,
    description: `${project.claudeFileCount} files, ${sizeKb} KB${gitInfo}`,
    detail: project.sourcePath,
    picked: true,
  };
}

async function chooseExportOptions(): Promise<ExportOptions | undefined> {
  interface OptionItem extends vscode.QuickPickItem {
    key: keyof ExportOptions;
  }
  const items: OptionItem[] = [
    {
      key: 'portableMigration',
      label: 'Portable path migration',
      description: 'Detect machine-specific paths so they can be rewritten on import',
      picked: DEFAULT_OPTIONS.portableMigration,
    },
    {
      key: 'securityScan',
      label: 'Security scan',
      description: 'Scan for obvious secrets/credentials before export',
      picked: DEFAULT_OPTIONS.securityScan,
    },
    {
      key: 'compress',
      label: 'Compress archive',
      description: 'Use DEFLATE compression (disable for fastest export of large binaries)',
      picked: DEFAULT_OPTIONS.compress,
    },
    {
      key: 'includeHostname',
      label: 'Advanced: include machine hostname in manifest',
      description: 'Off by default for privacy; not required for migration to work',
      picked: DEFAULT_OPTIONS.includeHostname,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Export options',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }
  const pickedKeys = new Set(picked.map((i) => i.key));
  return {
    portableMigration: pickedKeys.has('portableMigration'),
    securityScan: pickedKeys.has('securityScan'),
    compress: pickedKeys.has('compress'),
    includeHostname: pickedKeys.has('includeHostname'),
  };
}

async function countReferences(projects: DiscoveredProject[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const refs = await scanProjectReferences(project.claudePath, {
      projectRoot: project.sourcePath,
      homeDir: project.homeDirectory,
      workspaceRoot: project.sourcePath,
      style: project.platform === 'win32' ? 'win32' : 'posix',
    });
    counts.set(project.id, refs.length);
  }
  return counts;
}

async function showReviewStep(
  projects: DiscoveredProject[],
  options: ExportOptions,
  findingsCount: number,
  referenceCounts: Map<string, number>,
): Promise<boolean> {
  const totalFiles = projects.reduce((sum, p) => sum + p.claudeFileCount, 0);
  const totalBytes = projects.reduce((sum, p) => sum + p.claudeSizeBytes, 0);
  const totalReferences = [...referenceCounts.values()].reduce((a, b) => a + b, 0);

  const lines = [
    `Projects: ${projects.map((p) => p.name).join(', ')}`,
    `Total files: ${totalFiles}`,
    `Total size: ${formatBytes(totalBytes)}`,
    options.portableMigration
      ? `Detected machine-specific references: ${totalReferences}`
      : 'Portable path migration: disabled',
    options.securityScan
      ? `Security warnings remaining: ${findingsCount > 0 ? findingsCount + ' (reviewed above)' : 'none'}`
      : 'Security scan: disabled',
  ];

  const proceedLabel = 'Export';
  const choice = await vscode.window.showInformationMessage(
    `Review export:\n${lines.join('\n')}`,
    { modal: true, detail: lines.join('\n') },
    proceedLabel,
  );
  return choice === proceedLabel;
}

export async function exportSingleFolder(folder: vscode.Uri): Promise<void> {
  const claudeDirPath = path.join(folder.fsPath, '.claude');
  if (!(await pathExists(claudeDirPath))) {
    vscode.window.showWarningMessage(`No .claude directory found in ${folder.fsPath}.`);
    return;
  }
  await runExportWizard(folder);
}
