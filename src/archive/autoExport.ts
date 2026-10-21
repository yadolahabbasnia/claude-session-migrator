import * as fs from 'node:fs/promises';
import { walkFiles, looksBinary } from '../utils/filesystem';
import { redactSecrets, scanTextForSecrets } from '../security/secretScanner';
import { toPortableRelativePath } from '../utils/paths';
import { scanSessionProjects } from '../discovery/sessionScanner';
import { createArchive, type ArchiveSessionInput } from './archiveWriter';
import type { DiscoveredSessionProject } from '../models/session';

export interface HeadlessExportResult {
  projectCount: number;
  fileCount: number;
  archiveSizeBytes: number;
  /** Files that contained secret-like text and were archived with those spans redacted. */
  redactedSecretFiles: number;
}

/**
 * Exports every Claude Code session project under `sessionsRoot` to `destinationFile` with no
 * user interaction -- for the background auto-sync watcher, which can't pop a quickpick per
 * detected secret the way the interactive export wizard does. A file that trips the secret
 * scanner is still archived, with only the matched secret spans replaced by `[REDACTED:<rule>]`
 * placeholders. It is never dropped: session transcripts routinely contain token-like strings,
 * and excluding whole files silently shrank the archive to almost nothing (and then overwrote
 * the good one in the repo).
 */
export async function runHeadlessSessionsExport(
  sessionsRoot: string,
  destinationFile: string,
): Promise<HeadlessExportResult | undefined> {
  const projects = await scanSessionProjects(sessionsRoot);
  if (projects.length === 0) {
    return undefined;
  }

  const inputs: ArchiveSessionInput[] = [];
  let redactedSecretFiles = 0;

  for (const project of projects) {
    const placeholders = await redactSecretFlaggedFiles(project);
    redactedSecretFiles += placeholders.size;
    inputs.push({ project, placeholderContent: placeholders.size > 0 ? placeholders : undefined });
  }

  const result = await createArchive({
    destinationFile,
    projects: [],
    sessionProjects: inputs,
    includeHostname: false,
    compress: true,
  });

  return {
    projectCount: projects.length,
    fileCount: result.fileCount,
    archiveSizeBytes: result.archiveSizeBytes,
    redactedSecretFiles,
  };
}

async function redactSecretFlaggedFiles(project: DiscoveredSessionProject): Promise<Map<string, string>> {
  const redacted = new Map<string, string>();
  for await (const file of walkFiles(project.folderPath)) {
    const buffer = await fs.readFile(file.absolutePath);
    if (looksBinary(buffer)) {
      continue;
    }
    const relative = toPortableRelativePath(file.relativePath);
    const text = buffer.toString('utf8');
    if (scanTextForSecrets(relative, text).length > 0) {
      redacted.set(relative, redactSecrets(relative, text).content);
    }
  }
  return redacted;
}
