import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { ensureDir, isDirectory, pathExists, walkFiles } from '../utils/filesystem';
import { toPortableRelativePath } from '../utils/paths';
import { logger } from '../utils/logging';

export interface MergeSessionBackupOptions {
  backupFolderPath: string;
  liveFolderPath: string;
}

export interface MergeSessionBackupResult {
  /** `.jsonl` file names copied from the backup into the live project. */
  copiedSessions: string[];
  /** `.jsonl` file names that already existed (by name) in the live project and were left
   * untouched -- session file names are UUID-based, so this should be rare, but a merge must
   * never silently overwrite a live session. */
  skippedExistingSessions: string[];
  /** `memory/<relative path>` entries copied from the backup. */
  copiedMemoryFiles: string[];
  skippedExistingMemoryFiles: string[];
}

/**
 * Copies whatever the backup has that the live project doesn't, by file name -- never the other
 * way around, and never overwriting anything already in the live project. This is the only
 * direction that's safe to do without user review: the backup is a pre-import snapshot (see
 * `migrationEngine.createBackup`), so anything it has that the live folder also has is, at
 * worst, an older version of the same session; anything it has that the live folder *doesn't*
 * have is a session that would otherwise be lost once the backup is cleaned up.
 */
export async function mergeSessionBackupIntoLive(
  options: MergeSessionBackupOptions,
): Promise<MergeSessionBackupResult> {
  const { backupFolderPath, liveFolderPath } = options;
  const result: MergeSessionBackupResult = {
    copiedSessions: [],
    skippedExistingSessions: [],
    copiedMemoryFiles: [],
    skippedExistingMemoryFiles: [],
  };

  await ensureDir(liveFolderPath);
  const entries = await fsp.readdir(backupFolderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue;
    }
    const sourcePath = path.join(backupFolderPath, entry.name);
    const destPath = path.join(liveFolderPath, entry.name);
    if (await pathExists(destPath)) {
      result.skippedExistingSessions.push(entry.name);
      continue;
    }
    await fsp.copyFile(sourcePath, destPath);
    result.copiedSessions.push(entry.name);
  }

  const backupMemoryDir = path.join(backupFolderPath, 'memory');
  if (await isDirectory(backupMemoryDir)) {
    const liveMemoryDir = path.join(liveFolderPath, 'memory');
    for await (const file of walkFiles(backupMemoryDir)) {
      const relative = toPortableRelativePath(file.relativePath);
      const destPath = path.join(liveMemoryDir, ...relative.split('/'));
      if (await pathExists(destPath)) {
        result.skippedExistingMemoryFiles.push(relative);
        continue;
      }
      await ensureDir(path.dirname(destPath));
      await fsp.copyFile(file.absolutePath, destPath);
      result.copiedMemoryFiles.push(relative);
    }
  }

  logger.info('Merged session backup into live project', {
    backupFolderPath,
    liveFolderPath,
    copiedSessions: result.copiedSessions.length,
    skippedExistingSessions: result.skippedExistingSessions.length,
    copiedMemoryFiles: result.copiedMemoryFiles.length,
  });

  return result;
}
