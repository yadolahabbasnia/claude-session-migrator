import * as path from 'node:path';
import { pathExists, isDirectory, readTextFile } from '../utils/filesystem';
import type { GitInfo } from '../models/project';

/**
 * Detects git repository info by reading `.git` directly (no `git` binary required, so this
 * works even when git isn't installed or isn't on PATH).
 */
export async function detectGitInfo(projectPath: string): Promise<GitInfo | undefined> {
  const gitDir = await findGitDir(projectPath);
  if (!gitDir) {
    return undefined;
  }
  const repoRoot = path.dirname(gitDir);
  const remoteUrls = await readRemoteUrls(gitDir);
  const branch = await readCurrentBranch(gitDir);
  return { repoRoot, remoteUrls, branch };
}

async function findGitDir(startPath: string): Promise<string | undefined> {
  let current = path.resolve(startPath);
  for (let i = 0; i < 64; i++) {
    const candidate = path.join(current, '.git');
    if (await isDirectory(candidate)) {
      return candidate;
    }
    if (await pathExists(candidate)) {
      // Worktrees / submodules store a `.git` *file* pointing at the real gitdir.
      const resolved = await resolveGitFile(candidate);
      if (resolved) {
        return resolved;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

async function resolveGitFile(gitFilePath: string): Promise<string | undefined> {
  try {
    const content = await readTextFile(gitFilePath);
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) {
      return undefined;
    }
    const gitdir = match[1].trim();
    return path.isAbsolute(gitdir) ? gitdir : path.resolve(path.dirname(gitFilePath), gitdir);
  } catch {
    return undefined;
  }
}

async function readRemoteUrls(gitDir: string): Promise<string[]> {
  const configPath = path.join(gitDir, 'config');
  if (!(await pathExists(configPath))) {
    return [];
  }
  try {
    const content = await readTextFile(configPath);
    const urls: string[] = [];
    const sectionPattern = /\[remote "([^"]+)"\][^[]*/g;
    let match: RegExpExecArray | null;
    while ((match = sectionPattern.exec(content)) !== null) {
      const section = match[0];
      const urlMatch = section.match(/url\s*=\s*(.+)/);
      if (urlMatch) {
        urls.push(urlMatch[1].trim());
      }
    }
    return urls;
  } catch {
    return [];
  }
}

async function readCurrentBranch(gitDir: string): Promise<string | undefined> {
  const headPath = path.join(gitDir, 'HEAD');
  if (!(await pathExists(headPath))) {
    return undefined;
  }
  try {
    const content = (await readTextFile(headPath)).trim();
    const match = content.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (match) {
      return match[1];
    }
    // Detached HEAD: content is the raw commit SHA.
    return content ? `detached:${content.slice(0, 12)}` : undefined;
  } catch {
    return undefined;
  }
}

/** Normalizes a git remote URL so equivalent forms (ssh vs https, trailing .git) compare equal. */
export function normalizeRemoteUrl(remoteUrl: string): string {
  let normalized = remoteUrl.trim();
  normalized = normalized.replace(/\.git$/i, '');
  // git@host:owner/repo -> host/owner/repo
  const scpMatch = normalized.match(/^([\w.-]+)@([\w.-]+):(.+)$/);
  if (scpMatch) {
    normalized = `${scpMatch[2]}/${scpMatch[3]}`;
  } else {
    normalized = normalized.replace(/^\w+:\/\//, '');
  }
  normalized = normalized.replace(/^[\w.-]+@/, '');
  return normalized.toLowerCase().replace(/\/+$/, '');
}
