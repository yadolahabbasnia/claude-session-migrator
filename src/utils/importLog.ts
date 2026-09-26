import * as path from 'node:path';
import { getClaudeHomeDir } from './claudeHome';
import { pathExists, readTextFile, writeTextFile } from './filesystem';
import { isImportLogEntry, type ImportLogEntry } from '../models/importLog';
import { logger } from './logging';

export function getImportLogPath(claudeHomeDir: string = getClaudeHomeDir()): string {
  return path.join(claudeHomeDir, 'migrator-import-log.json');
}

export async function readImportLog(logPath: string = getImportLogPath()): Promise<ImportLogEntry[]> {
  if (!(await pathExists(logPath))) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(await readTextFile(logPath));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isImportLogEntry);
  } catch (err) {
    logger.warn('Failed to read import log -- treating as empty', { logPath, error: String(err) });
    return [];
  }
}

async function writeImportLog(entries: ImportLogEntry[], logPath: string = getImportLogPath()): Promise<void> {
  await writeTextFile(logPath, JSON.stringify(entries, null, 2));
}

export async function appendImportLogEntries(
  newEntries: ImportLogEntry[],
  logPath: string = getImportLogPath(),
): Promise<void> {
  if (newEntries.length === 0) {
    return;
  }
  const existing = await readImportLog(logPath);
  await writeImportLog([...existing, ...newEntries], logPath);
}

export async function removeImportLogEntries(
  ids: string[],
  logPath: string = getImportLogPath(),
): Promise<void> {
  const existing = await readImportLog(logPath);
  const idSet = new Set(ids);
  await writeImportLog(
    existing.filter((e) => !idSet.has(e.id)),
    logPath,
  );
}
