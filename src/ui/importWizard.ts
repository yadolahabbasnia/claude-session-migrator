import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateArchive } from '../validation/validator';
import { extractProjectToStaging } from '../archive/archiveReader';
import { matchDestination } from '../migration/destinationMatcher';
import { buildMigrationPreview } from '../migration/migrationPlan';
import { applyMigration } from '../migration/migrationEngine';
import { runHealthCheck, type HealthCheckReport } from '../validation/healthCheck';
import { createTempDir, cleanupTempDir } from '../utils/filesystem';
import type { PathContext } from '../migration/pathResolver';
import type { ManifestProjectEntry } from '../models/manifest';
import type { ProjectMigrationPreview } from '../models/migration';
import { withCancellableProgress } from './progress';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';
import {
  gatherDestinationCandidates,
  promptForDestinationFolder,
  findContainingWorkspaceFolder,
  confirmPreviewAndChooseStrategies,
  showFinalReport,
  type PreviewGroupItem,
  type FinalReportItem,
} from './migrationWizardShared';

export async function runImportWizard(preselectedFile?: vscode.Uri): Promise<void> {
  const tempDirs: string[] = [];
  try {
    const archiveFile = preselectedFile?.fsPath ?? (await pickArchiveFile());
    if (!archiveFile) {
      return;
    }

    const validation = validateArchive(archiveFile);
    if (!validation.ok || !validation.archive) {
      vscode.window.showErrorMessage(
        `Claude Migrator: archive validation failed.\n${validation.errors.join('\n')}`,
        { modal: true },
      );
      return;
    }
    if (validation.warnings.length > 0) {
      vscode.window.showWarningMessage(`Claude Migrator: ${validation.warnings.join(' ')}`);
    }

    const archive = validation.archive;
    const selectedEntries = await selectProjectsToImport(archive.manifest.projects);
    if (!selectedEntries || selectedEntries.length === 0) {
      return;
    }

    const candidates = await gatherDestinationCandidates();

    const mappings = new Map<string, string>(); // projectId -> destinationPath
    for (const entry of selectedEntries) {
      const match = matchDestination(entry, candidates);
      let destinationPath = match.confidence !== 'none' ? match.destinationPath : undefined;
      if (!destinationPath) {
        destinationPath = await promptForDestinationFolder(entry.name, entry.sourcePath);
      } else {
        logger.info('Auto-matched destination', {
          project: entry.name,
          destinationPath,
          matchedBy: match.matchedBy,
          confidence: match.confidence,
        });
      }
      if (!destinationPath) {
        const skip = await vscode.window.showWarningMessage(
          `No destination selected for "${entry.name}" -- it will be skipped.`,
          'Continue',
          'Cancel Import',
        );
        if (skip !== 'Continue') {
          return;
        }
        continue;
      }
      mappings.set(entry.id, destinationPath);
    }

    if (mappings.size === 0) {
      vscode.window.showInformationMessage('No projects were mapped to a destination; import cancelled.');
      return;
    }

    const previews: Array<{
      entry: ManifestProjectEntry;
      preview: ProjectMigrationPreview;
      stagingDir: string;
      sourceContext: PathContext;
      destContext: PathContext;
    }> = [];

    await withCancellableProgress('Preparing migration preview...', async (reporter) => {
      for (const entry of selectedEntries) {
        const destinationPath = mappings.get(entry.id);
        if (!destinationPath || reporter.isCancelled()) {
          continue;
        }
        reporter.report(`Analyzing ${entry.name}...`);
        const stagingDir = await createTempDir(`import-${entry.id}`);
        tempDirs.push(stagingDir);
        await extractProjectToStaging(archive, entry.id, stagingDir);

        const sourceContext: PathContext = {
          projectRoot: entry.sourcePath,
          homeDir: archive.manifest.source.homeDirectory,
          workspaceRoot: entry.sourcePath,
          style: archive.manifest.source.platform === 'win32' ? 'win32' : 'posix',
        };
        const destContext: PathContext = {
          projectRoot: destinationPath,
          homeDir: os.homedir(),
          workspaceRoot: findContainingWorkspaceFolder(destinationPath) ?? destinationPath,
          style: process.platform === 'win32' ? 'win32' : 'posix',
        };

        const preview = await buildMigrationPreview({
          projectId: entry.id,
          projectName: entry.name,
          stagedContentDir: stagingDir,
          destinationPath,
          destinationContentDir: path.join(destinationPath, '.claude'),
          sourceContext,
          destContext,
        });

        previews.push({ entry, preview, stagingDir, sourceContext, destContext });
      }
    });

    if (previews.length === 0) {
      return;
    }

    const groupItems: PreviewGroupItem[] = previews.map((p) => ({
      id: p.entry.id,
      label: p.entry.name,
      preview: p.preview,
    }));
    const strategies = await confirmPreviewAndChooseStrategies(groupItems, '.claude directory');
    if (!strategies) {
      return;
    }

    const results = await withCancellableProgress('Importing Claude projects...', async (reporter) => {
      const applyResults: FinalReportItem[] = [];

      for (const { entry, preview, stagingDir, sourceContext, destContext } of previews) {
        if (reporter.isCancelled()) {
          break;
        }
        const strategy = strategies.get(entry.id) ?? 'backup-and-replace';
        reporter.report(`Importing ${entry.name}...`);

        const applyResult = await applyMigration({
          preview,
          stagedContentDir: stagingDir,
          strategy,
          sourceContext,
          destContext,
        });

        let health: HealthCheckReport | undefined;
        if (strategy !== 'skip') {
          health = await runHealthCheck({
            destinationContentDir: applyResult.destinationContentDir,
            expectedFileCount: preview.totalFiles,
            sourceContext,
            unresolvedReferences: preview.unresolvedReferences,
          });
        }

        applyResults.push({ id: entry.id, label: entry.name, health, backupPath: applyResult.backupPath, strategy });
      }
      return applyResults;
    });

    await showFinalReport(results);
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Import failed', { error: String(err) });
    vscode.window.showErrorMessage(`Claude Migrator: import failed -- ${(err as Error).message}`);
  } finally {
    for (const dir of tempDirs) {
      const err = await cleanupTempDir(dir);
      if (err) {
        logger.warn('Failed to clean up temp staging directory', { dir, error: String(err) });
      }
    }
  }
}

async function pickArchiveFile(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Claude Migration Transfer': ['cmt'] },
    title: 'Select a .cmt archive to import',
  });
  return uris?.[0]?.fsPath;
}

interface ProjectEntryItem extends vscode.QuickPickItem {
  entry: ManifestProjectEntry;
}

async function selectProjectsToImport(
  entries: ManifestProjectEntry[],
): Promise<ManifestProjectEntry[] | undefined> {
  const items: ProjectEntryItem[] = entries.map((entry) => ({
    entry,
    label: `$(folder) ${entry.name}`,
    description: `${entry.fileCount} files, ${Math.max(1, Math.round(entry.sizeBytes / 1024))} KB`,
    detail: entry.sourcePath,
    picked: true,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select projects to import',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  return picked?.map((i) => i.entry);
}
