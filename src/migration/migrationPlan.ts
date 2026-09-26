import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { walkFiles, looksBinary, pathExists } from '../utils/filesystem';
import { toPortableRelativePath } from '../utils/paths';
import { computeLineStarts, lineNumberForIndex } from '../utils/text';
import { createPeriodicYielder } from '../utils/async';
import { transformFileContent } from './ruleEngine';
import { classifyPortablePath, type PathContext } from './pathResolver';
import type {
  FileMigrationAction,
  ProjectMigrationPreview,
  UnresolvedReference,
} from '../models/migration';

export interface PreviewProgress {
  processed: number;
  total: number;
  fileName: string;
}

export interface BuildPreviewOptions {
  projectId: string;
  projectName: string;
  /** Extracted archive contents for this project (a temp staging directory). */
  stagedContentDir: string;
  /** Destination project/session-project root, for display and destination-matching. */
  destinationPath: string;
  /** Where the migrated files actually get compared against / written to. Callers compute this
   * (e.g. `path.join(destinationPath, '.claude')` for project config, or the project's encoded
   * session directory for Claude Code sessions) so this module stays agnostic of what kind of
   * content it's migrating. */
  destinationContentDir: string;
  sourceContext: PathContext;
  destContext: PathContext;
  onProgress?: (p: PreviewProgress) => void;
}

export async function buildMigrationPreview(
  options: BuildPreviewOptions,
): Promise<ProjectMigrationPreview> {
  const { destinationContentDir } = options;
  const destinationExists = await pathExists(destinationContentDir);

  const files: FileMigrationAction[] = [];
  const unresolvedReferences: UnresolvedReference[] = [];
  const warnings: string[] = [];
  let totalReplacements = 0;
  let newFiles = 0;
  let modifiedFiles = 0;
  let existingFilesPreserved = 0;

  const total = options.onProgress ? await countFiles(options.stagedContentDir) : 0;
  let processed = 0;
  const yieldPeriodically = createPeriodicYielder();

  for await (const staged of walkFiles(options.stagedContentDir)) {
    const relativePath = toPortableRelativePath(staged.relativePath);
    const destFilePath = path.join(destinationContentDir, ...relativePath.split('/'));
    const buffer = await fs.readFile(staged.absolutePath);
    const isBinary = looksBinary(buffer);

    let replacements = 0;
    let finalContent: Buffer = buffer;

    if (!isBinary) {
      const text = buffer.toString('utf8');
      const transformed = transformFileContent(relativePath, text, options.sourceContext, options.destContext);
      replacements = transformed.replacements;
      finalContent = Buffer.from(transformed.content, 'utf8');
      totalReplacements += replacements;

      if (transformed.jsonValidationFailed) {
        warnings.push(
          `${relativePath}: path replacement would have produced invalid JSON; left unmodified.`,
        );
      }

      if (transformed.unresolved.length > 0) {
        const lineStarts = computeLineStarts(text);
        for (const unresolved of transformed.unresolved) {
          unresolvedReferences.push({
            projectId: options.projectId,
            file: relativePath,
            line: lineNumberForIndex(lineStarts, unresolved.index),
            originalPath: unresolved.originalPath,
            kind: classifyPortablePath(unresolved.originalPath, options.sourceContext),
            resolution: 'unresolved',
          });
        }
      }
    }

    const destExists = await pathExists(destFilePath);
    let action: FileMigrationAction['action'];
    if (!destExists) {
      action = 'create';
      newFiles += 1;
    } else {
      const existingContent = await fs.readFile(destFilePath).catch(() => undefined);
      if (existingContent && existingContent.equals(finalContent)) {
        action = 'preserve';
        existingFilesPreserved += 1;
      } else {
        action = 'modify';
        modifiedFiles += 1;
      }
    }

    files.push({ relativePath, action, isBinary, pathReplacements: replacements });
    processed += 1;
    options.onProgress?.({ processed, total, fileName: relativePath });
    await yieldPeriodically();
  }

  if (unresolvedReferences.length > 0) {
    warnings.push(
      `${unresolvedReferences.length} machine-specific path reference(s) could not be automatically resolved.`,
    );
  }

  return {
    projectId: options.projectId,
    projectName: options.projectName,
    destinationPath: options.destinationPath,
    destinationContentDir,
    destinationExists,
    files,
    totalFiles: files.length,
    newFiles,
    modifiedFiles,
    existingFilesPreserved,
    pathReplacements: totalReplacements,
    warnings,
    unresolvedReferences,
  };
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  for await (const file of walkFiles(dir)) {
    void file;
    count += 1;
  }
  return count;
}
