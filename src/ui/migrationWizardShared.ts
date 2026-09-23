import * as vscode from 'vscode';
import * as path from 'node:path';
import { detectGitInfo } from '../discovery/gitDetector';
import { pathExists } from '../utils/filesystem';
import type { DestinationCandidate } from '../migration/destinationMatcher';
import type { ApplyStrategy } from '../migration/migrationEngine';
import type { HealthCheckReport } from '../validation/healthCheck';
import type { ProjectMigrationPreview } from '../models/migration';
import { logger } from '../utils/logging';

/** Shared helpers used by both the project-config and Claude Code session import wizards, so
 * destination matching, strategy selection, and reporting stay consistent between the two. */

export async function gatherDestinationCandidates(): Promise<DestinationCandidate[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const candidates: DestinationCandidate[] = [];
  for (const folder of folders) {
    const git = await detectGitInfo(folder.uri.fsPath);
    candidates.push({
      path: folder.uri.fsPath,
      name: path.basename(folder.uri.fsPath),
      remoteUrls: git?.remoteUrls,
      hasClaudeDir: await pathExists(path.join(folder.uri.fsPath, '.claude')),
      isCurrentWorkspaceFolder: true,
    });
  }
  return candidates;
}

export async function promptForDestinationFolder(
  itemLabel: string,
  sourceDescription: string,
): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: `Select destination for "${itemLabel}"`,
    title: `Source: ${sourceDescription}\nSelect a destination folder for "${itemLabel}"`,
  });
  return uris?.[0]?.fsPath;
}

export function findContainingWorkspaceFolder(destinationPath: string): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(
    (f) => destinationPath === f.uri.fsPath || destinationPath.startsWith(f.uri.fsPath + path.sep),
  );
  return folder?.uri.fsPath;
}

export interface PreviewGroupItem {
  id: string;
  label: string;
  preview: ProjectMigrationPreview;
}

/**
 * For each preview whose destination already has content, asks the user how to handle it
 * (backup-and-replace / merge / skip / cancel). Then shows the full combined preview and
 * requires an explicit "Import" confirmation before anything is written to disk.
 */
export async function confirmPreviewAndChooseStrategies(
  items: PreviewGroupItem[],
  existingContentDescription: string,
): Promise<Map<string, ApplyStrategy> | undefined> {
  const strategies = new Map<string, ApplyStrategy>();

  for (const { id, label, preview } of items) {
    if (preview.destinationExists) {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '$(archive) Backup and replace',
            description: `Back up the existing ${existingContentDescription}, then write the imported files`,
            strategy: 'backup-and-replace' as const,
          },
          {
            label: '$(diff) Merge',
            description: `Back up first, then overlay imported files onto the existing ${existingContentDescription}`,
            strategy: 'merge' as const,
          },
          { label: '$(circle-slash) Skip', description: 'Leave this untouched', strategy: 'skip' as const },
          { label: '$(close) Cancel import', description: '', strategy: 'cancel' as const },
        ],
        {
          title: `"${label}" already has ${existingContentDescription} at the destination`,
          ignoreFocusOut: true,
        },
      );
      if (!choice || choice.strategy === 'cancel') {
        return undefined;
      }
      strategies.set(id, choice.strategy);
    } else {
      strategies.set(id, 'backup-and-replace');
    }
  }

  const summary = items
    .map(
      ({ label, preview: p }) =>
        `${label} -> ${p.destinationPath}\n` +
        `  Files: ${p.totalFiles}  New: ${p.newFiles}  Modified: ${p.modifiedFiles}  Existing: ${p.existingFilesPreserved}\n` +
        `  Path replacements: ${p.pathReplacements}  Warnings: ${p.warnings.length}`,
    )
    .join('\n\n');

  const importLabel = 'Import';
  const choice = await vscode.window.showInformationMessage(
    `Migration preview:\n\n${summary}`,
    { modal: true, detail: summary },
    importLabel,
  );
  return choice === importLabel ? strategies : undefined;
}

export interface FinalReportItem {
  id: string;
  label: string;
  health?: HealthCheckReport;
  backupPath?: string;
  strategy: ApplyStrategy;
}

export async function showFinalReport(items: FinalReportItem[]): Promise<void> {
  const lines = items.map((item) => {
    if (item.strategy === 'skip') {
      return `${item.label}: skipped`;
    }
    const h = item.health;
    const status = h && h.failed > 0 ? 'FAILED' : h && h.warnings > 0 ? 'completed with warnings' : 'succeeded';
    const backupNote = item.backupPath ? ` (backup at ${path.basename(item.backupPath)})` : '';
    return `${item.label}: ${status}${backupNote}\n${(h?.items ?? [])
      .map((i) => `  ${statusIcon(i.status)} ${i.message}`)
      .join('\n')}`;
  });

  const details = lines.join('\n\n');
  await vscode.window.showInformationMessage('Import complete.', { modal: true, detail: details });
  logger.info('Import complete', { summary: details });
}

function statusIcon(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
}
