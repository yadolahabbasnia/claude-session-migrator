import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { readImportLog, removeImportLogEntries } from '../utils/importLog';
import { pathExists } from '../utils/filesystem';
import type { ImportLogEntry } from '../models/importLog';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';

interface UndoQuickPickItem extends vscode.QuickPickItem {
  entry: ImportLogEntry;
}

export async function runUndoImportWizard(): Promise<void> {
  try {
    const entries = await readImportLog();
    if (entries.length === 0) {
      vscode.window.showInformationMessage('Claude Migrator: no tracked imports to remove.');
      return;
    }

    const items: UndoQuickPickItem[] = [...entries].reverse().map((entry) => ({
      entry,
      label: `$(${entry.kind === 'session' ? 'comment-discussion' : 'folder'}) ${entry.label}`,
      description: new Date(entry.importedAt).toLocaleString(),
      detail: entry.destinationContentDir,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Select imports to remove',
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (!picked || picked.length === 0) {
      return;
    }

    const summary = picked
      .map(
        (i) =>
          `${i.entry.label} -- ${
            i.entry.backupPath
              ? 'restore the pre-import backup'
              : i.entry.existedBefore
                ? 'leave as-is (no backup found)'
                : 'delete entirely (nothing existed there before this import)'
          }`,
      )
      .join('\n');
    const confirmLabel = 'Remove';
    const confirmed = await vscode.window.showWarningMessage(
      'This will undo the selected imports on disk. This cannot be undone further.',
      { modal: true, detail: summary },
      confirmLabel,
    );
    if (confirmed !== confirmLabel) {
      return;
    }

    const removedIds: string[] = [];
    const failures: string[] = [];
    for (const { entry } of picked) {
      try {
        await revertEntry(entry);
        removedIds.push(entry.id);
      } catch (err) {
        logger.error('Failed to undo import', { entry: entry.label, error: String(err) });
        failures.push(`${entry.label}: ${(err as Error).message}`);
      }
    }

    if (removedIds.length > 0) {
      await removeImportLogEntries(removedIds);
    }

    const doneMessage =
      failures.length === 0
        ? `Removed ${removedIds.length} imported item(s).`
        : `Removed ${removedIds.length} item(s); ${failures.length} failed:\n${failures.join('\n')}`;
    vscode.window.showInformationMessage(`Claude Migrator: ${doneMessage}`);
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Undo import failed', { error: String(err) });
    vscode.window.showErrorMessage(`Claude Migrator: undo failed -- ${(err as Error).message}`);
  }
}

/**
 * Reverts one imported item: restores the pre-import backup if one exists, otherwise (when
 * nothing existed at the destination before the import) deletes what the import wrote.
 */
async function revertEntry(entry: ImportLogEntry): Promise<void> {
  if (entry.backupPath && (await pathExists(entry.backupPath))) {
    await fs.rm(entry.destinationContentDir, { recursive: true, force: true });
    await fs.rename(entry.backupPath, entry.destinationContentDir);
    return;
  }

  if (!entry.existedBefore) {
    await fs.rm(entry.destinationContentDir, { recursive: true, force: true });
    return;
  }

  throw new Error('existing content was modified in place and no backup was recorded -- skipped for safety');
}
