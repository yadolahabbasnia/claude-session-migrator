import * as fs from 'node:fs/promises';
import { walkFiles, looksBinary } from '../utils/filesystem';
import { scanTextForSecrets } from '../security/secretScanner';
import { toPortableRelativePath } from '../utils/paths';
import { scanSessionProjects } from '../discovery/sessionScanner';
import { createArchive, type ArchiveSessionInput } from './archiveWriter';
import type { DiscoveredSessionProject } from '../models/session';

export interface HeadlessExportResult {
  projectCount: number;
  fileCount: number;
  archiveSizeBytes: number;
  skippedSecretFiles: number;
}

/**
 * Exports every Claude Code session project under `sessionsRoot` to `destinationFile` with no
 * user interaction -- for the background auto-sync watcher, which can't pop a quickpick per
 * detected secret the way the interactive export wizard does. Any file that trips the secret
 * scanner is silently excluded (never included, never prompted) rather than guessing what the
 * user would have picked; `skippedSecretFiles` reports how many so the caller can surface it.
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
  let skippedSecretFiles = 0;

  for (const project of projects) {
    const excluded = await findSecretFlaggedFiles(project);
    skippedSecretFiles += excluded.size;
    inputs.push({ project, excludedRelativePaths: excluded.size > 0 ? excluded : undefined });
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
    skippedSecretFiles,
  };
}

async function findSecretFlaggedFiles(project: DiscoveredSessionProject): Promise<Set<string>> {
  const flagged = new Set<string>();
  for await (const file of walkFiles(project.folderPath)) {
    const buffer = await fs.readFile(file.absolutePath);
    if (looksBinary(buffer)) {
      continue;
    }
    const relative = toPortableRelativePath(file.relativePath);
    if (scanTextForSecrets(relative, buffer.toString('utf8')).length > 0) {
      flagged.add(relative);
    }
  }
  return flagged;
}
