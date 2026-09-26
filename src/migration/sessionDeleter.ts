import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { UnsafeDeletionTargetError, toMigratorError } from '../utils/errors';
import { logger } from '../utils/logging';

/**
 * Deleting sessions removes the user's own conversation history, and the request arrives from
 * the webview as plain strings. So nothing here trusts the incoming path: every target is
 * re-derived from `<sessionsRoot>/<folderName>[/<fileName>]` and re-checked to sit exactly one
 * (project) or two (session file) segments below the sessions root before it is touched.
 *
 * Actual removal is injected (`Remover`) rather than hard-coded, so the UI layer can route it
 * through the OS trash via `vscode.workspace.fs.delete({ useTrash: true })` while unit tests --
 * and any non-vscode caller -- use a plain `fs.rm`. This module stays vscode-free like the rest
 * of the non-ui layers.
 */

/** What the caller asked to delete. `fileNames` are bare names, never paths. */
export type SessionDeletionRequest =
  | { kind: 'project'; folderName: string }
  | { kind: 'sessions'; folderName: string; fileNames: string[] };

export interface DeletionTarget {
  /** Absolute path that will be removed. Always under the sessions root. */
  absolutePath: string;
  /** Directories need a recursive remove; session files do not. */
  recursive: boolean;
  kind: 'project' | 'session';
  /** Short, human-readable name for confirmation prompts and logs. */
  label: string;
}

export type Remover = (absolutePath: string, options: { recursive: boolean }) => Promise<void>;

/** Default remover: a permanent delete. The UI layer passes a trash-backed one instead. */
export const permanentRemover: Remover = async (absolutePath, options) => {
  await fsp.rm(absolutePath, { recursive: options.recursive, force: false });
};

const SESSION_FILE_PATTERN = /^[^/\\]+\.jsonl$/;

function assertSafeSegment(segment: string, sessionsRoot: string, what: string): void {
  if (!segment || segment === '.' || segment === '..') {
    throw new UnsafeDeletionTargetError(path.join(sessionsRoot, segment), `invalid ${what}`);
  }
  if (segment.includes('/') || segment.includes('\\') || path.isAbsolute(segment)) {
    throw new UnsafeDeletionTargetError(segment, `${what} must be a bare name, not a path`);
  }
}

/**
 * Re-derives the absolute paths a request maps to and rejects anything that does not land
 * directly under `sessionsRoot`. Pure: touches no filesystem, so it is cheap to call before
 * showing a confirmation prompt.
 */
export function resolveDeletionTargets(
  sessionsRoot: string,
  request: SessionDeletionRequest,
): DeletionTarget[] {
  assertSafeSegment(request.folderName, sessionsRoot, 'project folder name');
  const folderPath = path.resolve(sessionsRoot, request.folderName);

  // Belt and braces: even with a bare segment, confirm the resolved path really is exactly one
  // level under the root. `path.relative` is used rather than string prefixing so this stays
  // correct for both separator styles and for case-insensitive Windows volumes.
  const folderRelative = path.relative(path.resolve(sessionsRoot), folderPath);
  if (
    folderRelative === '' ||
    folderRelative.startsWith('..') ||
    path.isAbsolute(folderRelative) ||
    folderRelative.split(path.sep).length !== 1
  ) {
    throw new UnsafeDeletionTargetError(folderPath, 'not a direct child of the sessions root');
  }

  if (request.kind === 'project') {
    return [{ absolutePath: folderPath, recursive: true, kind: 'project', label: request.folderName }];
  }

  if (request.fileNames.length === 0) {
    return [];
  }

  return request.fileNames.map((fileName) => {
    assertSafeSegment(fileName, sessionsRoot, 'session file name');
    if (!SESSION_FILE_PATTERN.test(fileName)) {
      throw new UnsafeDeletionTargetError(fileName, 'session files must end in .jsonl');
    }
    return {
      absolutePath: path.resolve(folderPath, fileName),
      recursive: false,
      kind: 'session' as const,
      label: fileName,
    };
  });
}

export interface DeletionOutcome {
  deleted: DeletionTarget[];
  /** One entry per target that could not be removed, with the reason. */
  failures: Array<{ target: DeletionTarget; message: string }>;
  /** Project folders removed afterwards because deleting sessions left them empty. */
  prunedFolders: string[];
}

export interface DeleteOptions {
  remove?: Remover;
  /** After deleting session files, remove the project folder if nothing at all is left in it. */
  pruneEmptyFolders?: boolean;
}

/**
 * Removes the given targets, continuing past individual failures so one locked file cannot
 * abort a multi-session delete. Never throws for a per-target failure -- those come back in
 * `failures` so the caller can report them precisely.
 */
export async function deleteSessionTargets(
  targets: DeletionTarget[],
  options: DeleteOptions = {},
): Promise<DeletionOutcome> {
  const remove = options.remove ?? permanentRemover;
  const outcome: DeletionOutcome = { deleted: [], failures: [], prunedFolders: [] };

  for (const target of targets) {
    try {
      await remove(target.absolutePath, { recursive: target.recursive });
      outcome.deleted.push(target);
      logger.info('Deleted session target', { path: target.absolutePath, kind: target.kind });
    } catch (err) {
      const message = toMigratorError(err, target.absolutePath).message;
      logger.error('Failed to delete session target', { path: target.absolutePath, error: message });
      outcome.failures.push({ target, message });
    }
  }

  if (options.pruneEmptyFolders) {
    const folders = new Set(
      outcome.deleted.filter((t) => t.kind === 'session').map((t) => path.dirname(t.absolutePath)),
    );
    for (const folder of folders) {
      if (await removeIfEmpty(folder, remove)) {
        outcome.prunedFolders.push(folder);
      }
    }
  }

  return outcome;
}

/**
 * Removes `folder` only when it is completely empty. Deleting the last session of a project
 * otherwise leaves a stub directory that the scanner hides (it skips folders with no `.jsonl`)
 * but that still sits on disk. A folder holding anything else -- most importantly a `memory/`
 * directory -- is left alone.
 */
async function removeIfEmpty(folder: string, remove: Remover): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fsp.readdir(folder);
  } catch {
    return false;
  }
  if (entries.length > 0) {
    return false;
  }
  try {
    await remove(folder, { recursive: true });
    logger.info('Pruned empty session project folder', { path: folder });
    return true;
  } catch (err) {
    logger.warn('Could not prune empty session project folder', {
      path: folder,
      error: String(err),
    });
    return false;
  }
}
