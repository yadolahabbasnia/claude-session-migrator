import * as path from 'node:path';

/**
 * Matches the exact backup-folder name `applyMigration` (see migrationEngine.ts `createBackup`)
 * produces before overwriting an existing session project during import:
 * `<original-folder-name>.backup-<ISO timestamp with `:`/`.` replaced by `-`>`, e.g.
 * `-home-user-my-api.backup-2026-10-05T10-44-27-529Z`. Kept in sync with that function
 * deliberately -- this is the one place besides it that needs to know the exact shape.
 */
const BACKUP_SUFFIX_PATTERN = /^(.+)\.backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/;

export interface SessionBackupCandidate {
  backupFolderName: string;
  backupFolderPath: string;
  liveFolderName: string;
  liveFolderPath: string;
  /** The raw `YYYY-MM-DDTHH-MM-SS-mmmZ` suffix, still safe to `Date.parse` after undoing the
   * `:`/`.` substitution. */
  backupTimestamp: string;
}

/** True for any folder name that matches the backup-suffix shape, regardless of whether a live
 * counterpart currently exists (an "orphaned" backup is still a backup, just not mergeable). */
export function isBackupFolderName(folderName: string): boolean {
  return BACKUP_SUFFIX_PATTERN.test(folderName);
}

/**
 * Finds every session-project folder under `sessionsRoot` that is a pre-import safety backup
 * (see `migrationEngine.createBackup`) of another folder that's still present -- i.e. a genuine
 * duplicate created by this extension's own "backup-and-replace" import strategy, not a
 * coincidence or a different real project. `folderNames` is every directory name already found
 * directly under `sessionsRoot` (the caller already has this from its own scan).
 */
export function detectSessionBackupCandidates(
  sessionsRoot: string,
  folderNames: string[],
): SessionBackupCandidate[] {
  const liveNames = new Set(folderNames);
  const candidates: SessionBackupCandidate[] = [];

  for (const name of folderNames) {
    const match = name.match(BACKUP_SUFFIX_PATTERN);
    if (!match) {
      continue;
    }
    const [, liveFolderName, backupTimestamp] = match;
    if (!liveNames.has(liveFolderName)) {
      continue;
    }
    candidates.push({
      backupFolderName: name,
      backupFolderPath: path.join(sessionsRoot, name),
      liveFolderName,
      liveFolderPath: path.join(sessionsRoot, liveFolderName),
      backupTimestamp,
    });
  }

  return candidates;
}

/** Parses a `backupTimestamp` back into a real `Date`, for display. */
export function parseBackupTimestamp(backupTimestamp: string): Date | undefined {
  // "2026-10-05T10-44-27-529Z" -> "2026-10-05T10:44:27.529Z"
  const match = backupTimestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!match) {
    return undefined;
  }
  const [, date, hh, mm, ss, ms] = match;
  const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
