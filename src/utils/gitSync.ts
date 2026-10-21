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
  const remoteHasBranch = (await runGit(['branch', '-r', '--list', `origin/${branch}`], localPath)).trim() !== '';
  const hasLocalBranch = (await runGit(['branch', '--list', branch], localPath)).trim() !== '';
  if (!hasLocalBranch) {
    await runGit(
      remoteHasBranch ? ['checkout', '-b', branch, `origin/${branch}`] : ['checkout', '-B', branch],
      localPath,
    );
  } else {
    await runGit(['checkout', branch], localPath);
  }
  if (!remoteHasBranch) {
    return; // brand-new sync repo: nothing to pull yet
  }
  // A real failure here (diverged history, dirty tree) must surface -- swallowing it left a
  // machine silently stuck on an old commit, so "pull" kept importing stale sessions.
  await runGit(['pull', '--rebase', '--autostash', 'origin', branch], localPath);
}

/** Stages every change, commits (if there is anything to commit), and pushes `branch`. */
export async function commitAndPush(localPath: string, branch: string, message: string): Promise<boolean> {
  await runGit(['add', '-A'], localPath);
  const status = await runGit(['status', '--porcelain'], localPath);
  if (!status.trim()) {
    return false;
  }
  await runGit(['commit', '-m', message], localPath);
  try {
    await runGit(['push', '-u', 'origin', branch], localPath);
  } catch {
    // Another machine pushed in the meantime: replay our commit on top of theirs and retry once.
    await runGit(['pull', '--rebase', 'origin', branch], localPath);
    await runGit(['push', '-u', 'origin', branch], localPath);
  }
  return true;
}

/** Size in bytes of `relativeFile` as of HEAD, or undefined if it isn't committed yet. */
export async function getCommittedFileSize(localPath: string, relativeFile: string): Promise<number | undefined> {
  try {
    const out = await runGit(['cat-file', '-s', `HEAD:${relativeFile}`], localPath);
    const size = Number.parseInt(out.trim(), 10);
    return Number.isNaN(size) ? undefined : size;
  } catch {
    return undefined;
  }
}

export interface SyncArchiveInfo {
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  /** Last commit date touching this file (ISO), when known. */
  committedAt?: string;
}

/** Every `.cmt` archive at the root of the sync checkout, newest commit first. */
export async function listSyncArchives(localPath: string): Promise<SyncArchiveInfo[]> {
  const entries = await fs.readdir(localPath, { withFileTypes: true });
  const infos: SyncArchiveInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.cmt')) {
      continue;
    }
    const absolutePath = path.join(localPath, entry.name);
    const stat = await fs.stat(absolutePath);
    let committedAt: string | undefined;
    try {
      committedAt = (await runGit(['log', '-1', '--format=%cI', '--', entry.name], localPath)).trim() || undefined;
    } catch {
      committedAt = undefined;
    }
    infos.push({ fileName: entry.name, absolutePath, sizeBytes: stat.size, committedAt });
  }
  return infos.sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? ''));
}

/** `claude-sessions.cmt` + host `my-pc` -> `claude-sessions-my-pc.cmt`, so each machine writes
 * its own archive and never overwrites what another machine pushed. */
export function machineArchiveFileName(baseFileName: string, hostname: string): string {
  const safeHost = hostname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'machine';
  const base = baseFileName.replace(/\.cmt$/i, '');
  return `${base}-${safeHost}.cmt`;
}

/** True when a new archive is less than half the size of the previously committed one -- far more
 * likely a broken/partial export than real data loss, so callers should not push it unasked. */
export function isSuspiciousShrink(previousBytes: number | undefined, nextBytes: number): boolean {
  return previousBytes !== undefined && previousBytes > 1024 * 1024 && nextBytes < previousBytes / 2;
}

/** Restores `relativeFile` to its committed state (or deletes it if it was never committed). */
export async function discardFileChanges(localPath: string, relativeFile: string): Promise<void> {
  try {
    await runGit(['checkout', '--', relativeFile], localPath);
  } catch {
    await fs.rm(path.join(localPath, relativeFile), { force: true });
  }
}

export interface RepoStatus {
  lastCommit?: { hash: string; iso: string; subject: string };
  /** Tracked or untracked changes in the checkout that haven't been committed yet. */
  uncommittedFiles: number;
  /** Local commits not pushed / remote commits not pulled, as of the last fetch (no network). */
  ahead?: number;
  behind?: number;
  /** When this checkout last talked to the remote (mtime of `.git/FETCH_HEAD`). */
  lastFetchedAt?: string;
}

/** Cheap, network-free snapshot of the sync checkout for the sidebar. Returns undefined when
 * `localPath` isn't a git checkout. Every query is best-effort: a failure just leaves a field out. */
export async function getRepoStatus(localPath: string, branch: string): Promise<RepoStatus | undefined> {
  if (!(await isDirectory(path.join(localPath, '.git')))) {
    return undefined;
  }
  const status: RepoStatus = { uncommittedFiles: 0 };
  try {
    const [hash, iso, ...subject] = (await runGit(['log', '-1', '--format=%H%x1f%cI%x1f%s'], localPath))
      .trim()
      .split('\x1f');
    if (hash && iso) {
      status.lastCommit = { hash, iso, subject: subject.join('\x1f') };
    }
  } catch {
    // no commits yet
  }
  try {
    status.uncommittedFiles = (await runGit(['status', '--porcelain'], localPath)).split('\n').filter(Boolean).length;
  } catch {
    // leave 0
  }
  try {
    const [ahead, behind] = (await runGit(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`], localPath))
      .trim()
      .split(/\s+/)
      .map((n) => Number.parseInt(n, 10));
    if (!Number.isNaN(ahead) && !Number.isNaN(behind)) {
      status.ahead = ahead;
      status.behind = behind;
    }
  } catch {
    // no upstream yet
  }
  try {
    status.lastFetchedAt = (await fs.stat(path.join(localPath, '.git', 'FETCH_HEAD'))).mtime.toISOString();
  } catch {
    // never fetched
  }
  return status;
}
