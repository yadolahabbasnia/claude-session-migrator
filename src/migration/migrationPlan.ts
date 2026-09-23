import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { walkFiles, looksBinary, pathExists } from '../utils/filesystem';
import { toPortableRelativePath } from '../utils/paths';
import { transformFileContent } from './ruleEngine';
import { classifyPortablePath, type PathContext } from './pathResolver';
import type {
  FileMigrationAction,
  ProjectMigrationPreview,
  UnresolvedReference,
} from '../models/migration';

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

  for await (const staged of walkFiles(options.stagedContentDir)) {
    const relativePath = toPortableRelativePath(staged.relativePath);
    const destFilePath = path.join(destinationContentDir, ...relativePath.split('/'));
    const buffer = await fs.readFile(staged.absolutePath);
    const isBinary = looksBinary(buffer);

    let replacements = 0;
    let finalContent: Buffer = buffer;

    if (!isBinary) {
      const transformed = transformFileContent(
        relativePath,
        buffer.toString('utf8'),
        options.sourceContext,
        options.destContext,
      );
      replacements = transformed.replacements;
      finalContent = Buffer.from(transformed.content, 'utf8');
      totalReplacements += replacements;

      if (transformed.jsonValidationFailed) {
        warnings.push(
          `${relativePath}: path replacement would have produced invalid JSON; left unmodified.`,
        );
      }

      for (const unresolved of transformed.unresolved) {
        unresolvedReferences.push({
          projectId: options.projectId,
          file: relativePath,
          line: lineForIndex(buffer.toString('utf8'), unresolved.index),
          originalPath: unresolved.originalPath,
          kind: classifyPortablePath(unresolved.originalPath, options.sourceContext),
          resolution: 'unresolved',
        });
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

function lineForIndex(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') {
      line += 1;
    }
  }
  return line;
}
