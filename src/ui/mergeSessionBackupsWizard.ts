import * as vscode from 'vscode';
import * as fsp from 'node:fs/promises';
import { detectSessionBackupCandidates, parseBackupTimestamp, type SessionBackupCandidate } from '../discovery/backupDetector';
import { mergeSessionBackupIntoLive, type MergeSessionBackupResult } from '../migration/sessionMerger';
import { resolveDeletionTargets, deleteSessionTargets } from '../migration/sessionDeleter';
import { trashRemover, permanentVscodeRemover } from './sessionDeleteWizard';
import { getClaudeHomeDir, getSessionsRootDir } from '../utils/claudeHome';
import { withCancellableProgress } from './progress';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';

/** Lists every directory directly under `sessionsRoot`, without the full session-content scan
 * `scanSessionProjects` does -- all the merge wizard needs up front is names. */
async function listProjectFolderNames(sessionsRoot: string): Promise<string[]> {
  const entries = await fsp.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function countJsonlFiles(folderPath: string): Promise<number> {
  const entries = await fsp.readdir(folderPath, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).length;
}

export async function findMergeableSessionBackups(): Promise<SessionBackupCandidate[]> {
  const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());
  const folderNames = await listProjectFolderNames(sessionsRoot);
  return detectSessionBackupCandidates(sessionsRoot, folderNames);
}

interface CandidateItem extends vscode.QuickPickItem {
  candidate: SessionBackupCandidate;
}

/**
 * Finds pre-import safety backups this extension created (see `migrationEngine.createBackup`,
 * `<project-folder>.backup-<timestamp>`) that still have their live project folder sitting next
 * to them, and offers to fold any sessions the backup has that the live folder doesn't back into
 * it -- then optionally trashes the now-redundant backup folder. Never overwrites anything in
 * the live folder (see `mergeSessionBackupIntoLive`).
 */
export async function runMergeSessionBackupsWizard(): Promise<void> {
  try {
    const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());
    const candidates = await withCancellableProgress('Scanning for session backup folders...', async () => {
      return findMergeableSessionBackups();
    });

    if (candidates.length === 0) {
      vscode.window.showInformationMessage(
        'Claude Migrator: no mergeable session backup folders were found. ' +
          '(These only appear after an import that used the "backup and replace" strategy on an existing project.)',
      );
      return;
    }

    const items: CandidateItem[] = await Promise.all(
      candidates.map(async (candidate) => {
        const [backupCount, liveCount] = await Promise.all([
          countJsonlFiles(candidate.backupFolderPath),
          countJsonlFiles(candidate.liveFolderPath),
        ]);
        const when = parseBackupTimestamp(candidate.backupTimestamp)?.toLocaleString() ?? candidate.backupTimestamp;
        return {
          candidate,
          label: `$(archive) ${candidate.liveFolderName}`,
          description: `backup from ${when}`,
          detail: `${backupCount} session(s) in the backup, ${liveCount} currently in the live project`,
          picked: true,
        };
      }),
    );

    const selected = await vscode.window.showQuickPick(items, {
      title: `${candidates.length} backup folder(s) can be merged back into their project`,
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (!selected || selected.length === 0) {
      return;
    }

    const results: Array<{ candidate: SessionBackupCandidate; result: MergeSessionBackupResult }> = [];
    await withCancellableProgress('Merging session backups...', async (reporter) => {
      for (const item of selected) {
        if (reporter.isCancelled()) {
          break;
        }
        reporter.report(item.candidate.liveFolderName);
        const result = await mergeSessionBackupIntoLive({
          backupFolderPath: item.candidate.backupFolderPath,
          liveFolderPath: item.candidate.liveFolderPath,
        });
        results.push({ candidate: item.candidate, result });
      }
    });

    const totalCopied = results.reduce((sum, r) => sum + r.result.copiedSessions.length, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.result.skippedExistingSessions.length, 0);

    const deleteLabel = 'Merge and Delete Backups';
    const keepLabel = 'Merge Only (Keep Backups)';
    const choice = await vscode.window.showInformationMessage(
      `Merged ${totalCopied} session(s) from ${results.length} backup folder(s) into their live projects` +
        (totalSkipped > 0 ? ` (${totalSkipped} already present, left untouched).` : '.') +
        ' Move the now-redundant backup folders to the trash?',
      { modal: true },
      deleteLabel,
      keepLabel,
    );

    if (choice !== deleteLabel) {
      return;
    }

    let trashFailures = 0;
    await withCancellableProgress('Removing merged backup folders...', async (reporter) => {
      for (const { candidate } of results) {
        if (reporter.isCancelled()) {
          break;
        }
        const targets = resolveDeletionTargets(sessionsRoot, {
          kind: 'project',
          folderName: candidate.backupFolderName,
        });
        const outcome = await deleteSessionTargets(targets, {
          remove: async (absolutePath, opts) => {
            try {
              await trashRemover(absolutePath, opts);
            } catch (err) {
              logger.warn('Trash delete failed for merged backup, falling back to permanent delete', {
                path: absolutePath,
                error: String(err),
              });
              await permanentVscodeRemover(absolutePath, opts);
            }
          },
        });
        trashFailures += outcome.failures.length;
      }
    });

    vscode.window.showInformationMessage(
      trashFailures === 0
        ? `Claude Migrator: removed ${results.length} merged backup folder(s).`
        : `Claude Migrator: removed ${results.length - trashFailures} merged backup folder(s); ${trashFailures} could not be removed.`,
    );
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Merge session backups failed', { error: String(err) });
    vscode.window.showErrorMessage(`Claude Migrator: merging session backups failed -- ${(err as Error).message}`);
  }
}
