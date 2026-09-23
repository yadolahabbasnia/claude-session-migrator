import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { walkFiles, looksBinary, ensureDir, pathExists } from '../utils/filesystem';
import { toPortableRelativePath } from '../utils/paths';
import { transformFileContent } from './ruleEngine';
import type { PathContext } from './pathResolver';
import type { ExistingDataStrategy, ProjectMigrationPreview } from '../models/migration';
import { logger } from '../utils/logging';

/** The subset of strategies that can actually be applied ('cancel' aborts before this point). */
export type ApplyStrategy = Exclude<ExistingDataStrategy, 'cancel'>;

export interface ApplyMigrationOptions {
  preview: ProjectMigrationPreview;
  stagedContentDir: string;
  strategy: ApplyStrategy;
  sourceContext: PathContext;
  destContext: PathContext;
}

export interface ApplyMigrationResult {
  destinationContentDir: string;
  backupPath?: string;
  filesWritten: number;
  filesSkipped: number;
  strategy: ExistingDataStrategy;
  rolledBack: boolean;
}

/**
 * Applies a previously-built migration preview to disk. Follows a prepare -> backup -> apply
 * -> finalize sequence, and attempts to roll back to the pre-migration backup if any step
 * after the backup fails.
 */
export async function applyMigration(options: ApplyMigrationOptions): Promise<ApplyMigrationResult> {
  const { preview, strategy } = options;
  const { destinationContentDir } = preview;

  if (strategy === 'skip') {
    logger.info('Skipping migration for existing project by user choice', {
      projectId: preview.projectId,
    });
    return {
      destinationContentDir,
      filesWritten: 0,
      filesSkipped: preview.totalFiles,
      strategy,
      rolledBack: false,
    };
  }

  let backupPath: string | undefined;
  const destinationExists = await pathExists(destinationContentDir);
  if (destinationExists) {
    backupPath = await createBackup(destinationContentDir);
    logger.info('Created backup of existing content directory', { backupPath });
  }

  try {
    let filesWritten: number;
    if (strategy === 'backup-and-replace') {
      filesWritten = await replaceAll(options, destinationContentDir);
    } else {
      filesWritten = await mergeInto(options, destinationContentDir);
    }
    return { destinationContentDir, backupPath, filesWritten, filesSkipped: 0, strategy, rolledBack: false };
  } catch (err) {
    logger.error('Migration apply failed, attempting rollback', { error: String(err) });
    if (backupPath) {
      await rollback(destinationContentDir, backupPath);
    }
    throw err;
  }
}

async function createBackup(destinationContentDir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${destinationContentDir}.backup-${timestamp}`;
  await copyRecursive(destinationContentDir, backupPath);
  return backupPath;
}

async function rollback(destinationContentDir: string, backupPath: string): Promise<void> {
  try {
    await fs.rm(destinationContentDir, { recursive: true, force: true });
    await copyRecursive(backupPath, destinationContentDir);
    logger.warn('Rolled back to pre-migration backup', { destinationContentDir });
  } catch (err) {
    logger.error('Rollback failed -- backup preserved for manual recovery', {
      backupPath,
      error: String(err),
    });
  }
}

async function replaceAll(options: ApplyMigrationOptions, destinationContentDir: string): Promise<number> {
  await fs.rm(destinationContentDir, { recursive: true, force: true });
  await ensureDir(destinationContentDir);
  let count = 0;
  for await (const staged of walkFiles(options.stagedContentDir)) {
    await writeTransformed(options, staged.absolutePath, staged.relativePath, destinationContentDir);
    count += 1;
  }
  return count;
}

async function mergeInto(options: ApplyMigrationOptions, destinationContentDir: string): Promise<number> {
  await ensureDir(destinationContentDir);
  let count = 0;
  for await (const staged of walkFiles(options.stagedContentDir)) {
    await writeTransformed(options, staged.absolutePath, staged.relativePath, destinationContentDir, {
      jsonMerge: true,
    });
    count += 1;
  }
  return count;
}

async function writeTransformed(
  options: ApplyMigrationOptions,
  sourceAbsolutePath: string,
  relativeNativePath: string,
  destinationContentDir: string,
  merge?: { jsonMerge: boolean },
): Promise<void> {
  const relativePath = toPortableRelativePath(relativeNativePath);
  const destPath = path.join(destinationContentDir, ...relativePath.split('/'));
  const buffer = await fs.readFile(sourceAbsolutePath);

  if (looksBinary(buffer)) {
    await ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, buffer);
    return;
  }

  const transformed = transformFileContent(
    relativePath,
    buffer.toString('utf8'),
    options.sourceContext,
    options.destContext,
  );

  let finalText = transformed.content;
  if (merge?.jsonMerge && path.extname(relativePath).toLowerCase() === '.json' && (await pathExists(destPath))) {
    finalText = await mergeJsonFile(destPath, finalText);
  }

  await ensureDir(path.dirname(destPath));
  await fs.writeFile(destPath, finalText, 'utf8');
}

async function mergeJsonFile(destPath: string, incomingText: string): Promise<string> {
  try {
    const existing = JSON.parse(await fs.readFile(destPath, 'utf8'));
    const incoming = JSON.parse(incomingText);
    return JSON.stringify(deepMergeJson(existing, incoming), null, 2);
  } catch {
    // If either side isn't valid JSON, fall back to the incoming (already-transformed) content.
    return incomingText;
  }
}

/** One level of recursive plain-object merge; incoming values win, arrays are replaced wholesale. */
function deepMergeJson(existing: unknown, incoming: unknown): unknown {
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const result: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      result[key] = key in existing ? deepMergeJson((existing as Record<string, unknown>)[key], value) : value;
    }
    return result;
  }
  return incoming;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function copyRecursive(source: string, destination: string): Promise<void> {
  await ensureDir(destination);
  for await (const file of walkFiles(source)) {
    const destPath = path.join(destination, ...toPortableRelativePath(file.relativePath).split('/'));
    await ensureDir(path.dirname(destPath));
    await fs.copyFile(file.absolutePath, destPath);
  }
}
