import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { detectGitInfo, normalizeRemoteUrl } from '../discovery/gitDetector';
import { ensureDir, isDirectory, pathExists } from './filesystem';
import { MigratorError } from './errors';

const execFileAsync = promisify(execFile);

/** Raised for any git-sync failure the user needs to see (not a generic Node error). */
export class GitSyncError extends MigratorError {
  constructor(message: string) {
    super(message, 'GIT_SYNC_ERROR');
  }
}

/**
 * Raised when the configured local path is not a checkout of the configured remote --
 * the "correct path" check the user must pass before any push/pull happens, so sessions
 * never get synced into (or read from) the wrong repository by mistake.
 */
export class WrongRepositoryError extends GitSyncError {
  constructor(
    public readonly localPath: string,
    public readonly expectedRemoteUrl: string,
    public readonly actualRemoteUrls: string[],
  ) {
    super(
      `"${localPath}" is a git repository, but its remote(s) (${actualRemoteUrls.join(', ') || 'none'}) ` +
        `do not match the configured sync repository (${expectedRemoteUrl}). Refusing to sync -- ` +
        `point "Claude Migrator: Sync Sessions via Git" at the correct local checkout, or update the ` +
        `configured repository URL.`,
    );
  }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
    return stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    const message = stderr?.trim() || (err as Error).message;
    throw new GitSyncError(`git ${args[0]} failed: ${message}`);
  }
}

export async function isGitInstalled(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures `localPath` is a valid, correct checkout of `remoteUrl`:
 * - if it doesn't exist (or is empty), clones the repo there;
 * - if it already contains a git repository, verifies its remote(s) match `remoteUrl` and
 *   throws {@link WrongRepositoryError} if not;
 * - if it exists, is non-empty, and isn't a git repository at all, throws a {@link GitSyncError}.
 */
export async function ensureRepoAtPath(localPath: string, remoteUrl: string, branch: string): Promise<void> {
  const exists = await pathExists(localPath);
  if (exists) {
    const isDir = await isDirectory(localPath);
    if (!isDir) {
      throw new GitSyncError(`"${localPath}" exists and is not a directory.`);
    }
    const gitInfo = await detectGitInfo(localPath);
    if (gitInfo && path.resolve(gitInfo.repoRoot) === path.resolve(localPath)) {
      const expected = normalizeRemoteUrl(remoteUrl);
      const matches = gitInfo.remoteUrls.some((url) => normalizeRemoteUrl(url) === expected);
      if (!matches) {
        throw new WrongRepositoryError(localPath, remoteUrl, gitInfo.remoteUrls);
      }
      return;
    }
    const entries = await fs.readdir(localPath);
    if (entries.length > 0) {
      throw new GitSyncError(
        `"${localPath}" already exists, is not empty, and is not a git checkout of ${remoteUrl}. ` +
          `Choose an empty or non-existent folder for the sync repository.`,
      );
    }
  }

  await ensureDir(localPath);
  await runGit(['clone', '--branch', branch, '--single-branch', remoteUrl, '.'], localPath).catch(async (err) => {
    // Some remotes don't have `branch` yet (e.g. a brand-new empty repo) -- fall back to a
    // plain clone of the default branch and let the caller create/push the branch later.
    await runGit(['clone', remoteUrl, '.'], localPath);
    void err;
  });
}

export async function pull(localPath: string, branch: string): Promise<void> {
  await runGit(['fetch', 'origin'], localPath);
  const hasBranch = await runGit(['branch', '--list', branch], localPath);
  if (!hasBranch.trim()) {
    await runGit(['checkout', '-b', branch, `origin/${branch}`], localPath).catch(() =>
      runGit(['checkout', '-B', branch], localPath),
    );
  } else {
    await runGit(['checkout', branch], localPath);
  }
  await runGit(['pull', '--ff-only', 'origin', branch], localPath).catch(() => {
    // Remote branch may not exist yet on a brand-new sync repo.
  });
}

/** Stages every change, commits (if there is anything to commit), and pushes `branch`. */
export async function commitAndPush(localPath: string, branch: string, message: string): Promise<boolean> {
  await runGit(['add', '-A'], localPath);
  const status = await runGit(['status', '--porcelain'], localPath);
  if (!status.trim()) {
    return false;
  }
  await runGit(['commit', '-m', message], localPath);
  await runGit(['push', '-u', 'origin', branch], localPath);
  return true;
}
