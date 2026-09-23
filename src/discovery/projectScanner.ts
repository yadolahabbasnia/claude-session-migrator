import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DEFAULT_IGNORED_DIRECTORIES } from '../utils/filesystem';
import { findClaudeDir, summarizeClaudeDir } from './claudeDetector';
import { detectGitInfo, normalizeRemoteUrl } from './gitDetector';
import { getMachineInfo } from '../utils/platform';
import type { DiscoveredProject } from '../models/project';
import { logger } from '../utils/logging';

export interface ScanOptions {
  maxDepth?: number;
  ignoredDirectories?: Set<string>;
  /** Root each discovered project's `relativePath` should be computed against, if any. */
  workspaceRoot?: string;
  onProgress?: (info: { currentPath: string; found: number }) => void;
  isCancelled?: () => boolean;
}

const DEFAULT_MAX_DEPTH = 6;

export async function scanForProjects(
  roots: string[],
  options: ScanOptions = {},
): Promise<DiscoveredProject[]> {
  const ignored = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const machine = getMachineInfo();
  const results: DiscoveredProject[] = [];
  const seenRealPaths = new Set<string>();
  const visitedDirRealPaths = new Set<string>();

  async function visit(dir: string, depth: number): Promise<void> {
    if (options.isCancelled?.()) {
      return;
    }
    let real: string;
    try {
      real = await fs.realpath(dir);
    } catch (err) {
      logger.debug('Skipping unreadable path during scan', { dir, error: String(err) });
      return;
    }
    if (visitedDirRealPaths.has(real)) {
      return;
    }
    visitedDirRealPaths.add(real);

    options.onProgress?.({ currentPath: dir, found: results.length });

    const claudePath = await findClaudeDir(dir);
    if (claudePath) {
      const claudeReal = await fs.realpath(claudePath).catch(() => claudePath);
      if (!seenRealPaths.has(claudeReal)) {
        seenRealPaths.add(claudeReal);
        try {
          const project = await buildProject(dir, claudePath, machine, options.workspaceRoot);
          results.push(project);
        } catch (err) {
          logger.warn('Failed to analyze detected Claude project', { dir, error: String(err) });
        }
      }
    }

    if (depth >= maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.debug('Permission denied while scanning', { dir, error: String(err) });
      return;
    }

    for (const entry of entries) {
      if (options.isCancelled?.()) {
        return;
      }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name === '.claude' || ignored.has(entry.name)) {
        continue;
      }
      const childPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(childPath);
          if (!stat.isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }
      }
      await visit(childPath, depth + 1);
    }
  }

  for (const root of roots) {
    await visit(path.resolve(root), 0);
  }

  return results;
}

async function buildProject(
  projectPath: string,
  claudePath: string,
  machine: ReturnType<typeof getMachineInfo>,
  workspaceRoot: string | undefined,
): Promise<DiscoveredProject> {
  const [summary, git] = await Promise.all([
    summarizeClaudeDir(claudePath),
    detectGitInfo(projectPath),
  ]);

  const name = path.basename(projectPath);
  const id = computeProjectId(projectPath, git?.remoteUrls);
  const relativePath = workspaceRoot ? path.relative(workspaceRoot, projectPath) : undefined;

  return {
    id,
    name,
    sourcePath: projectPath,
    claudePath,
    relativePath: relativePath && !relativePath.startsWith('..') ? relativePath : undefined,
    platform: machine.platform,
    username: machine.username,
    homeDirectory: machine.homeDirectory,
    hostname: machine.hostname,
    git,
    claudeSizeBytes: summary.sizeBytes,
    claudeFileCount: summary.fileCount,
    lastModified: summary.lastModified,
  };
}

/**
 * Prefers a stable identity derived from the git remote (so the same project is recognized
 * across machines and paths). Falls back to a generated identifier derived from the project
 * name plus a short hash of the source path when no git remote is available.
 */
export function computeProjectId(projectPath: string, remoteUrls: string[] | undefined): string {
  if (remoteUrls && remoteUrls.length > 0) {
    const normalized = normalizeRemoteUrl(remoteUrls[0]);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `git:${hash}`;
  }
  const name = path.basename(projectPath);
  const hash = crypto
    .createHash('sha256')
    .update(projectPath.toLowerCase())
    .digest('hex')
    .slice(0, 12);
  return `path:${slugify(name)}-${hash}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}
