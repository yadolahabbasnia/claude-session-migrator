import * as vscode from 'vscode';
import * as path from 'node:path';
import { scanSessionProjects } from '../discovery/sessionScanner';
import { getClaudeHomeDir, getSessionsRootDir } from '../utils/claudeHome';
import { scanProjectReferences } from '../migration/referenceScanner';
import { getMachineInfo } from '../utils/platform';
import { createArchive, type ArchiveSessionInput } from '../archive/archiveWriter';
import type { DiscoveredSessionProject } from '../models/session';
import { withCancellableProgress } from './progress';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';
import { runSecurityReview, pickArchiveDestinationFile, formatBytes } from './exportWizardShared';

/**
 * @param preselectedProjectId When provided (e.g. from the sidebar's per-item "Export" action),
 * skips the multi-select step and exports just that one session project.
 * @param preselectedDestinationFile When provided (e.g. from the git-sync wizard), skips the
 * save-file dialog and writes the archive directly to this path.
 */
export async function runSessionExportWizard(
  preselectedProjectId?: string,
  preselectedDestinationFile?: string,
): Promise<boolean> {
  try {
    const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());

    const projects = await withCancellableProgress('Scanning Claude Code sessions...', async (reporter) => {
      return scanSessionProjects(sessionsRoot, {
        isCancelled: () => reporter.isCancelled(),
        onProgress: (info) => reporter.report(`${info.folderName} (${info.found} found)`),
      });
    });

    if (projects.length === 0) {
      vscode.window.showInformationMessage(
        `No Claude Code sessions were found under ${sessionsRoot}.`,
      );
      return false;
    }

    let selected: DiscoveredSessionProject[] | undefined;
    if (preselectedProjectId) {
      const match = projects.find((p) => p.id === preselectedProjectId);
      if (!match) {
        vscode.window.showWarningMessage('That session project could not be found anymore -- try refreshing.');
        return false;
      }
      selected = [match];
    } else {
      selected = await selectSessionProjects(projects);
    }
    if (!selected || selected.length === 0) {
      return false;
    }

    const { excludedByTarget, placeholderByTarget, findingsCount } = await runSecurityReview(
      selected.map((p) => ({ id: p.id, label: displayName(p), rootPath: p.folderPath })),
    );

    const referenceCounts = await countReferences(selected);

    const proceed = await showReviewStep(selected, findingsCount, referenceCounts);
    if (!proceed) {
      return false;
    }

    const destination = preselectedDestinationFile ?? (await pickArchiveDestinationFile('claude-sessions'));
    if (!destination) {
      return false;
    }

    await withCancellableProgress('Exporting Claude Code sessions...', async (reporter) => {
      reporter.report(`Archiving ${selected.length} session project(s)...`);
      const inputs: ArchiveSessionInput[] = selected.map((project) => ({
        project,
        excludedRelativePaths: excludedByTarget.get(project.id),
        placeholderContent: placeholderByTarget.get(project.id),
      }));
      const result = await createArchive({
        destinationFile: destination,
        projects: [],
        sessionProjects: inputs,
        includeHostname: false,
        compress: true,
      });
      logger.info('Session export complete', {
        destination,
        projects: selected.length,
        files: result.fileCount,
        bytes: result.archiveSizeBytes,
      });
    });

    if (!preselectedDestinationFile) {
      const openFolder = 'Reveal in Explorer';
      const choice = await vscode.window.showInformationMessage(
        `Export complete: ${selected.length} session project(s) written to ${path.basename(destination)}.`,
        openFolder,
      );
      if (choice === openFolder) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(destination));
      }
    }
    return true;
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return false;
    }
    logger.error('Session export failed', { error: String(err) });
    vscode.window.showErrorMessage(`Claude Migrator: session export failed -- ${(err as Error).message}`);
    return false;
  }
}

function displayName(project: DiscoveredSessionProject): string {
  return project.sourcePath ? path.basename(project.sourcePath) : project.folderName;
}

interface SessionProjectItem extends vscode.QuickPickItem {
  project: DiscoveredSessionProject;
}

async function selectSessionProjects(
  projects: DiscoveredSessionProject[],
): Promise<DiscoveredSessionProject[] | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<SessionProjectItem>();
    quickPick.title = 'Select Claude Code session projects to export';
    quickPick.canSelectMany = true;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = projects.map(toItem);
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

function toItem(project: DiscoveredSessionProject): SessionProjectItem {
  const sizeKb = Math.max(1, Math.round(project.totalSizeBytes / 1024));
  const gitInfo = project.git ? ` -- ${project.git.remoteUrls[0] ?? 'git repo'}` : '';
  return {
    project,
    label: `$(comment-discussion) ${displayName(project)}`,
    description: `${project.sessions.length} session(s), ${sizeKb} KB${gitInfo}`,
    detail: project.sourcePath ?? `(source path unknown -- folder: ${project.folderName})`,
    picked: true,
  };
}

async function countReferences(projects: DiscoveredSessionProject[]): Promise<Map<string, number>> {
  const machine = getMachineInfo();
  const counts = new Map<string, number>();
  for (const project of projects) {
    if (!project.sourcePath) {
      counts.set(project.id, 0);
      continue;
    }
    const refs = await scanProjectReferences(project.folderPath, {
      projectRoot: project.sourcePath,
      homeDir: machine.homeDirectory,
      workspaceRoot: project.sourcePath,
      style: machine.platform === 'win32' ? 'win32' : 'posix',
    });
    counts.set(project.id, refs.length);
  }
  return counts;
}

async function showReviewStep(
  projects: DiscoveredSessionProject[],
  findingsCount: number,
  referenceCounts: Map<string, number>,
): Promise<boolean> {
  const totalSessions = projects.reduce((sum, p) => sum + p.sessions.length, 0);
  const totalBytes = projects.reduce((sum, p) => sum + p.totalSizeBytes, 0);
  const totalReferences = [...referenceCounts.values()].reduce((a, b) => a + b, 0);
  const unknownSourceCount = projects.filter((p) => !p.sourcePath).length;

  const lines = [
    `Session projects: ${projects.map(displayName).join(', ')}`,
    `Total sessions: ${totalSessions}`,
    `Total size: ${formatBytes(totalBytes)}`,
    `Detected machine-specific references: ${totalReferences}`,
    `Security warnings remaining: ${findingsCount > 0 ? findingsCount + ' (reviewed above)' : 'none'}`,
    ...(unknownSourceCount > 0
      ? [`Warning: ${unknownSourceCount} project(s) have no recoverable source path; their paths won't be migrated on import.`]
      : []),
  ];

  const proceedLabel = 'Export';
  const choice = await vscode.window.showInformationMessage(
    `Review export:\n${lines.join('\n')}`,
    { modal: true, detail: lines.join('\n') },
    proceedLabel,
  );
  return choice === proceedLabel;
}
