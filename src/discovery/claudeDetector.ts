import * as path from 'node:path';
import { isDirectory, computeDirStats } from '../utils/filesystem';

export const CLAUDE_DIR_NAME = '.claude';

export async function findClaudeDir(projectPath: string): Promise<string | undefined> {
  const candidate = path.join(projectPath, CLAUDE_DIR_NAME);
  return (await isDirectory(candidate)) ? candidate : undefined;
}

export interface ClaudeDirSummary {
  claudePath: string;
  sizeBytes: number;
  fileCount: number;
  lastModified: string;
}

export async function summarizeClaudeDir(claudePath: string): Promise<ClaudeDirSummary> {
  const stats = await computeDirStats(claudePath);
  return {
    claudePath,
    sizeBytes: stats.sizeBytes,
    fileCount: stats.fileCount,
    lastModified: stats.lastModifiedMs > 0 ? new Date(stats.lastModifiedMs).toISOString() : new Date(0).toISOString(),
  };
}
