import * as fs from 'node:fs/promises';
import { Dirent } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { toMigratorError } from './errors';

export const DEFAULT_IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.turbo',
  'coverage',
  '.vscode-test',
]);

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function readTextFile(target: string): Promise<string> {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (err) {
    throw toMigratorError(err, target);
  }
}

export async function writeTextFile(target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, content, 'utf8');
}

export async function copyFilePreserveBinary(source: string, destination: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await fs.copyFile(source, destination);
}

export interface DirStats {
  fileCount: number;
  sizeBytes: number;
  lastModifiedMs: number;
}

export async function computeDirStats(root: string): Promise<DirStats> {
  let fileCount = 0;
  let sizeBytes = 0;
  let lastModifiedMs = 0;
  for await (const file of walkFiles(root)) {
    const stat = await fs.stat(file.absolutePath);
    fileCount += 1;
    sizeBytes += stat.size;
    lastModifiedMs = Math.max(lastModifiedMs, stat.mtimeMs);
  }
  return { fileCount, sizeBytes, lastModifiedMs };
}

export interface WalkedFile {
  absolutePath: string;
  /** Relative to the root passed to walkFiles, using POSIX separators. */
  relativePath: string;
}

export interface WalkOptions {
  maxDepth?: number;
  ignoredDirectories?: Set<string>;
  /** Called when a directory can't be read (permission denied, etc). Never throws. */
  onError?: (target: string, error: unknown) => void;
}

/**
 * Recursively walks a directory tree yielding files, skipping common noise directories,
 * respecting a max depth, and guarding against symlink loops by tracking visited real paths.
 */
export async function* walkFiles(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkedFile> {
  const ignored = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;
  const maxDepth = options.maxDepth ?? 64;
  const visitedRealPaths = new Set<string>();

  async function* recurse(dir: string, relPrefix: string, depth: number): AsyncGenerator<WalkedFile> {
    if (depth > maxDepth) {
      return;
    }
    try {
      const real = await fs.realpath(dir);
      if (visitedRealPaths.has(real)) {
        return;
      }
      visitedRealPaths.add(real);
    } catch (err) {
      options.onError?.(dir, err);
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      options.onError?.(dir, err);
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) {
          continue;
        }
        yield* recurse(absolutePath, relativePath, depth + 1);
      } else if (entry.isFile()) {
        yield { absolutePath, relativePath };
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(absolutePath);
          if (stat.isDirectory()) {
            if (!ignored.has(entry.name)) {
              yield* recurse(absolutePath, relativePath, depth + 1);
            }
          } else if (stat.isFile()) {
            yield { absolutePath, relativePath };
          }
        } catch (err) {
          options.onError?.(absolutePath, err);
        }
      }
    }
  }

  yield* recurse(root, '', 0);
}

/** Heuristic binary detection: presence of a NUL byte in the first 8000 bytes. */
export function looksBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8000);
  for (let i = 0; i < sampleLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/** Returns free bytes on the filesystem containing `target`, or undefined if unsupported. */
export async function getAvailableDiskSpaceBytes(target: string): Promise<number | undefined> {
  const statfs = (fs as unknown as { statfs?: (p: string) => Promise<{ bavail: number; bsize: number }> })
    .statfs;
  if (!statfs) {
    return undefined;
  }
  try {
    const stats = await statfs(target);
    return stats.bavail * stats.bsize;
  } catch {
    return undefined;
  }
}

export async function directorySizeOnDisk(root: string): Promise<number> {
  const stats = await computeDirStats(root);
  return stats.sizeBytes;
}

/** Creates a fresh, uniquely-named directory under the OS temp directory. */
export async function createTempDir(prefix: string): Promise<string> {
  const base = path.join(os.tmpdir(), 'claude-project-migrator');
  await ensureDir(base);
  return fs.mkdtemp(path.join(base, `${prefix}-`));
}

/** Removes a temp directory, swallowing (but returning) any error rather than throwing. */
export async function cleanupTempDir(target: string): Promise<Error | undefined> {
  try {
    await fs.rm(target, { recursive: true, force: true });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}
