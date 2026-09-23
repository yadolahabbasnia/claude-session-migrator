import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { pathExists, isDirectory } from '../utils/filesystem';
import { detectGitInfo } from './gitDetector';
import { computeProjectId } from './projectScanner';
import type { DiscoveredSessionProject, SessionFileSummary } from '../models/session';
import { logger } from '../utils/logging';

interface RawSessionLine {
  type?: string;
  cwd?: string;
  sessionId?: string;
  slug?: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
}

async function readSessionSummary(filePath: string): Promise<SessionFileSummary> {
  const stat = await fsp.stat(filePath);
  const summary: SessionFileSummary = {
    fileName: path.basename(filePath),
    sizeBytes: stat.size,
    lastModified: stat.mtime.toISOString(),
    messageCount: 0,
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    if (!rawLine.trim()) {
      continue;
    }
    let parsed: RawSessionLine;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }

    if (parsed.sessionId && !summary.sessionId) {
      summary.sessionId = parsed.sessionId;
    }
    if (parsed.slug && !summary.slug) {
      summary.slug = parsed.slug;
    }
    if (!summary.firstTimestamp && parsed.timestamp) {
      summary.firstTimestamp = parsed.timestamp;
    }
    if (parsed.timestamp) {
      summary.lastTimestamp = parsed.timestamp;
    }

    if ((parsed.type === 'user' || parsed.type === 'assistant') && parsed.message) {
      summary.messageCount += 1;
      if (parsed.type === 'user' && !summary.firstUserMessagePreview) {
        const preview = extractTextPreview(parsed.message.content);
        if (preview) {
          summary.firstUserMessagePreview = preview;
        }
      }
    }
  }

  return summary;
}

function extractTextPreview(content: unknown, maxLength = 160): string | undefined {
  let text: string | undefined;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const block = content.find(
      (b): b is { type: string; text: string } =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text',
    );
    text = block?.text;
  }
  if (!text) {
    return undefined;
  }
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}...` : collapsed;
}

/** Reads the `cwd` recorded in a session file, without building a full summary. Cheap-ish: still
 * has to scan the file since `cwd` can appear on any line, but stops at the first match. */
async function readSessionCwd(filePath: string): Promise<string | undefined> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const rawLine of rl) {
    if (!rawLine.includes('"cwd"')) {
      continue;
    }
    try {
      const parsed = JSON.parse(rawLine) as RawSessionLine;
      if (parsed.cwd) {
        rl.close();
        return parsed.cwd;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

export interface ScanSessionsOptions {
  isCancelled?: () => boolean;
  onProgress?: (info: { folderName: string; found: number }) => void;
}

export async function scanSessionProjects(
  sessionsRoot: string,
  options: ScanSessionsOptions = {},
): Promise<DiscoveredSessionProject[]> {
  if (!(await pathExists(sessionsRoot))) {
    return [];
  }

  const entries = await fsp.readdir(sessionsRoot, { withFileTypes: true });
  const results: DiscoveredSessionProject[] = [];

  for (const entry of entries) {
    if (options.isCancelled?.()) {
      break;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    const folderPath = path.join(sessionsRoot, entry.name);
    options.onProgress?.({ folderName: entry.name, found: results.length });

    try {
      const project = await buildSessionProject(entry.name, folderPath);
      if (project) {
        results.push(project);
      }
    } catch (err) {
      logger.warn('Failed to analyze session project directory', { folderPath, error: String(err) });
    }
  }

  return results;
}

async function buildSessionProject(
  folderName: string,
  folderPath: string,
): Promise<DiscoveredSessionProject | undefined> {
  const dirEntries = await fsp.readdir(folderPath, { withFileTypes: true });
  const jsonlFiles = dirEntries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) {
    return undefined;
  }

  const sessions: SessionFileSummary[] = [];
  let totalSizeBytes = 0;
  let lastModifiedMs = 0;
  let sourcePath: string | undefined;
  let sourcePathFromMs = -1;

  for (const file of jsonlFiles) {
    const filePath = path.join(folderPath, file.name);
    const summary = await readSessionSummary(filePath);
    sessions.push(summary);
    totalSizeBytes += summary.sizeBytes;
    const mtimeMs = new Date(summary.lastModified).getTime();
    lastModifiedMs = Math.max(lastModifiedMs, mtimeMs);

    if (mtimeMs > sourcePathFromMs) {
      const cwd = await readSessionCwd(filePath);
      if (cwd) {
        sourcePath = cwd;
        sourcePathFromMs = mtimeMs;
      }
    }
  }

  const memoryDir = path.join(folderPath, 'memory');
  const hasMemoryDir = await isDirectory(memoryDir);
  if (hasMemoryDir) {
    totalSizeBytes += await directorySize(memoryDir);
  }

  const git = sourcePath && (await pathExists(sourcePath)) ? await detectGitInfo(sourcePath) : undefined;
  const id = computeProjectId(sourcePath ?? folderName, git?.remoteUrls);

  return {
    id,
    folderName,
    folderPath,
    sourcePath,
    sourcePathConfidence: sourcePath ? 'from-session-cwd' : 'unknown',
    git,
    sessions: sessions.sort((a, b) => b.lastModified.localeCompare(a.lastModified)),
    hasMemoryDir,
    totalSizeBytes,
    lastModified: new Date(lastModifiedMs || Date.now()).toISOString(),
  };
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full);
    } else if (entry.isFile()) {
      total += (await fsp.stat(full)).size;
    }
  }
  return total;
}

export interface SessionTurnPreview {
  role: string;
  text: string;
  timestamp?: string;
}

/** Reads a condensed, human-readable preview of a session's conversation for display in the
 * sidebar -- the first and last few turns, never the full raw transcript. */
export async function readSessionPreview(filePath: string, maxTurns = 10): Promise<SessionTurnPreview[]> {
  const turns: SessionTurnPreview[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    if (!rawLine.trim()) {
      continue;
    }
    let parsed: RawSessionLine;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if ((parsed.type === 'user' || parsed.type === 'assistant') && parsed.message) {
      const text = extractTextPreview(parsed.message.content, 400);
      if (text) {
        turns.push({ role: parsed.message.role ?? parsed.type, text, timestamp: parsed.timestamp });
      }
    }
  }

  if (turns.length <= maxTurns) {
    return turns;
  }
  const half = Math.floor(maxTurns / 2);
  return [...turns.slice(0, half), ...turns.slice(turns.length - (maxTurns - half))];
}
