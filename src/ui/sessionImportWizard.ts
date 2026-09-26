import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { validateArchive } from '../validation/validator';
import { extractSessionProjectToStaging } from '../archive/archiveReader';
import { matchDestination } from '../migration/destinationMatcher';
import { encodeProjectPath } from '../discovery/pathEncoding';
import { getClaudeHomeDir, getSessionsRootDir } from '../utils/claudeHome';
import { buildMigrationPreview } from '../migration/migrationPlan';
import { applyMigration } from '../migration/migrationEngine';
import { runHealthCheck, type HealthCheckReport } from '../validation/healthCheck';
import { createTempDir, cleanupTempDir } from '../utils/filesystem';
import type { PathContext } from '../migration/pathResolver';
import type { ManifestSessionEntry } from '../models/manifest';
import type { ProjectMigrationPreview } from '../models/migration';
import { withCancellableProgress } from './progress';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';
import { appendImportLogEntries } from '../utils/importLog';
import type { ImportLogEntry } from '../models/importLog';
import {
  gatherDestinationCandidates,
  promptForDestinationFolder,
  findContainingWorkspaceFolder,
  confirmPreviewAndChooseStrategies,
  showFinalReport,
  type PreviewGroupItem,
  type FinalReportItem,
} from './migrationWizardShared';

function entryLabel(entry: ManifestSessionEntry): string {
  return entry.sourcePath ? path.basename(entry.sourcePath) : entry.folderName;
}

export async function runSessionImportWizard(preselectedFile?: vscode.Uri): Promise<void> {
  const tempDirs: string[] = [];
  try {
    const archiveFile = preselectedFile?.fsPath ?? (await pickArchiveFile());
    if (!archiveFile) {
      return;
    }

    const validation = await withCancellableProgress('Validating archive...', async (reporter) => {
      return validateArchive(archiveFile, {
        onProgress: (label, p) => reporter.report(`${label}: ${p.processed}/${p.total} file(s)`),
      });
    });
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
    if (archive.manifest.sessionProjects.length === 0) {
      vscode.window.showInformationMessage('This archive contains no Claude Code sessions.');
      return;
    }

    const selectedEntries = await selectSessionsToImport(archive.manifest.sessionProjects);
    if (!selectedEntries || selectedEntries.length === 0) {
      return;
    }

    const candidates = await gatherDestinationCandidates();
    const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());

    const mappings = new Map<string, string>(); // entry.id -> destination project path
    for (const entry of selectedEntries) {
      const match = matchDestination(
        { id: entry.id, name: entryLabel(entry), git: entry.git },
        candidates,
      );
      let destinationPath = match.confidence !== 'none' ? match.destinationPath : undefined;
      if (!destinationPath) {
        destinationPath = await promptForDestinationFolder(
          entryLabel(entry),
          entry.sourcePath ?? `(unknown -- was ${entry.folderName})`,
        );
      } else {
        logger.info('Auto-matched session destination', {
          entry: entryLabel(entry),
          destinationPath,
          matchedBy: match.matchedBy,
          confidence: match.confidence,
        });
      }
      if (!destinationPath) {
        const skip = await vscode.window.showWarningMessage(
          `No destination selected for "${entryLabel(entry)}" -- it will be skipped.`,
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
      vscode.window.showInformationMessage('No sessions were mapped to a destination; import cancelled.');
      return;
    }

    const previews: Array<{
      entry: ManifestSessionEntry;
      preview: ProjectMigrationPreview;
      stagingDir: string;
      sourceContext: PathContext;
      destContext: PathContext;
    }> = [];

    await withCancellableProgress('Preparing session migration preview...', async (reporter) => {
      for (const entry of selectedEntries) {
        const destinationPath = mappings.get(entry.id);
        if (!destinationPath || reporter.isCancelled()) {
          continue;
        }
        reporter.report(`Extracting ${entryLabel(entry)}...`);
        const stagingDir = await createTempDir(`import-session-${entry.id}`);
        tempDirs.push(stagingDir);
        await extractSessionProjectToStaging(archive, entry.id, stagingDir, (p) =>
          reporter.report(`Extracting ${entryLabel(entry)}: ${p.processed}/${p.total} file(s)`),
        );
        reporter.report(`Analyzing ${entryLabel(entry)} for machine-specific paths...`);

        const sourceContext: PathContext = {
          projectRoot: entry.sourcePath ?? '',
          homeDir: archive.manifest.source.homeDirectory,
          workspaceRoot: entry.sourcePath ?? '',
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
          projectName: entryLabel(entry),
          stagedContentDir: stagingDir,
          destinationPath,
          destinationContentDir: path.join(sessionsRoot, encodeProjectPath(destinationPath)),
          sourceContext,
          destContext,
          onProgress: (p) =>
            reporter.report(`Analyzing ${entryLabel(entry)}: ${p.processed}/${p.total} (${p.fileName})`),
        });

        previews.push({ entry, preview, stagingDir, sourceContext, destContext });
      }
    });

    if (previews.length === 0) {
      return;
    }

    const groupItems: PreviewGroupItem[] = previews.map((p) => ({
      id: p.entry.id,
      label: entryLabel(p.entry),
      preview: p.preview,
    }));
    const strategies = await confirmPreviewAndChooseStrategies(groupItems, 'session data');
    if (!strategies) {
      return;
    }

    const logEntries: ImportLogEntry[] = [];
    const results = await withCancellableProgress('Importing Claude Code sessions...', async (reporter) => {
      const applyResults: FinalReportItem[] = [];

      for (const { entry, preview, stagingDir, sourceContext, destContext } of previews) {
        if (reporter.isCancelled()) {
          break;
        }
        const strategy = strategies.get(entry.id) ?? 'backup-and-replace';
        reporter.report(`Importing ${entryLabel(entry)}...`);

        const applyResult = await applyMigration({
          preview,
          stagedContentDir: stagingDir,
          strategy,
          sourceContext,
          destContext,
          onProgress: (p) =>
            reporter.report(
              `${p.stage === 'backup' ? 'Backing up' : 'Writing'} ${entryLabel(entry)}: ${p.processed} (${p.fileName})`,
            ),
        });

        let health: HealthCheckReport | undefined;
        if (strategy !== 'skip') {
          health = await runHealthCheck({
            destinationContentDir: applyResult.destinationContentDir,
            expectedFileCount: preview.totalFiles,
            sourceContext,
            unresolvedReferences: preview.unresolvedReferences,
          });
          logEntries.push({
            id: randomUUID(),
            kind: 'session',
            label: entryLabel(entry),
            destinationContentDir: applyResult.destinationContentDir,
            backupPath: applyResult.backupPath,
            existedBefore: preview.destinationExists,
            importedAt: new Date().toISOString(),
          });
        }

        applyResults.push({
          id: entry.id,
          label: entryLabel(entry),
          health,
          backupPath: applyResult.backupPath,
          strategy,
        });
      }
      return applyResults;
    });

    await appendImportLogEntries(logEntries);
    await showFinalReport(results);
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Session import failed', { error: String(err) });
    vscode.window.showErrorMessage(`Claude Migrator: session import failed -- ${(err as Error).message}`);
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
    title: 'Select a .cmt archive to import sessions from',
  });
  return uris?.[0]?.fsPath;
}

interface SessionEntryItem extends vscode.QuickPickItem {
  entry: ManifestSessionEntry;
}

async function selectSessionsToImport(
  entries: ManifestSessionEntry[],
): Promise<ManifestSessionEntry[] | undefined> {
  const items: SessionEntryItem[] = entries.map((entry) => ({
    entry,
    label: `$(comment-discussion) ${entryLabel(entry)}`,
    description: `${entry.sessionCount} session(s), ${Math.max(1, Math.round(entry.sizeBytes / 1024))} KB`,
    detail: entry.sourcePath ?? `(unknown source -- was ${entry.folderName})`,
    picked: true,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select Claude Code sessions to import',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  return picked?.map((i) => i.entry);
}
