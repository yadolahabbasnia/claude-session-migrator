import AdmZip = require('adm-zip');
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { walkFiles } from '../utils/filesystem';
import { sha256Buffer, type ChecksumMap } from './checksum';
import { serializeManifest } from './manifest';
import { getToolVersion } from './manifest';
import {
  MANIFEST_FORMAT_VERSION,
  type Manifest,
  type ManifestProjectEntry,
  type ManifestSessionEntry,
} from '../models/manifest';
import { getMachineInfo } from '../utils/platform';
import type { DiscoveredProject } from '../models/project';
import type { DiscoveredSessionProject } from '../models/session';
import { toPortableRelativePath } from '../utils/paths';
import { logger } from '../utils/logging';

export interface ArchiveProjectInput {
  project: DiscoveredProject;
  /** Relative (posix) paths under the .claude dir to exclude entirely from the archive. */
  excludedRelativePaths?: Set<string>;
  /** Relative (posix) path -> replacement text content, for "replace with placeholder". */
  placeholderContent?: Map<string, string>;
}

export interface ArchiveSessionInput {
  project: DiscoveredSessionProject;
  /** Relative (posix) paths under the session project folder to exclude entirely. */
  excludedRelativePaths?: Set<string>;
  /** Relative (posix) path -> replacement text content, for "replace with placeholder". */
  placeholderContent?: Map<string, string>;
}

export interface CreateArchiveOptions {
  destinationFile: string;
  projects: ArchiveProjectInput[];
  sessionProjects?: ArchiveSessionInput[];
  /** When false, hostname is omitted from the manifest (platform/homeDirectory are always
   * required for path migration and are never omitted). */
  includeHostname: boolean;
  compress: boolean;
}

export interface CreateArchiveResult {
  manifest: Manifest;
  fileCount: number;
  archiveSizeBytes: number;
}

export async function createArchive(options: CreateArchiveOptions): Promise<CreateArchiveResult> {
  const zip = new AdmZip();
  const checksums: ChecksumMap = {};
  const machine = getMachineInfo();
  const projectEntries: ManifestProjectEntry[] = [];
  let fileCount = 0;

  for (const input of options.projects) {
    const { project, excludedRelativePaths, placeholderContent } = input;
    const excludedFiles: string[] = [];
    let entryFileCount = 0;
    let entrySizeBytes = 0;

    for await (const file of walkFiles(project.claudePath)) {
      const relativePosix = toPortableRelativePath(file.relativePath);
      if (excludedRelativePaths?.has(relativePosix)) {
        excludedFiles.push(relativePosix);
        continue;
      }

      const archivePath = `projects/${project.id}/claude/${relativePosix}`;
      let content: Buffer;
      if (placeholderContent?.has(relativePosix)) {
        content = Buffer.from(placeholderContent.get(relativePosix)!, 'utf8');
      } else {
        content = await fs.readFile(file.absolutePath);
      }

      zip.addFile(archivePath, content);
      checksums[archivePath] = sha256Buffer(content);
      entryFileCount += 1;
      entrySizeBytes += content.length;
      fileCount += 1;
    }

    projectEntries.push({
      id: project.id,
      name: project.name,
      sourcePath: project.sourcePath,
      claudePath: project.claudePath,
      git: project.git
        ? {
            repoRoot: project.git.repoRoot,
            remoteUrls: project.git.remoteUrls,
            branch: project.git.branch,
          }
        : undefined,
      fileCount: entryFileCount,
      sizeBytes: entrySizeBytes,
      excludedFiles,
    });

    logger.info('Archived project', { id: project.id, files: entryFileCount });
  }

  const sessionEntries: ManifestSessionEntry[] = [];
  for (const input of options.sessionProjects ?? []) {
    const { project, excludedRelativePaths, placeholderContent } = input;
    const excludedFiles: string[] = [];
    let entrySizeBytes = 0;

    for await (const file of walkFiles(project.folderPath)) {
      const relativePosix = toPortableRelativePath(file.relativePath);
      if (excludedRelativePaths?.has(relativePosix)) {
        excludedFiles.push(relativePosix);
        continue;
      }

      const archivePath = `sessions/${project.id}/data/${relativePosix}`;
      let content: Buffer;
      if (placeholderContent?.has(relativePosix)) {
        content = Buffer.from(placeholderContent.get(relativePosix)!, 'utf8');
      } else {
        content = await fs.readFile(file.absolutePath);
      }

      zip.addFile(archivePath, content);
      checksums[archivePath] = sha256Buffer(content);
      entrySizeBytes += content.length;
      fileCount += 1;
    }

    sessionEntries.push({
      id: project.id,
      folderName: project.folderName,
      sourcePath: project.sourcePath,
      git: project.git
        ? {
            repoRoot: project.git.repoRoot,
            remoteUrls: project.git.remoteUrls,
            branch: project.git.branch,
          }
        : undefined,
      sessionCount: project.sessions.length,
      sizeBytes: entrySizeBytes,
      hasMemoryDir: project.hasMemoryDir,
      excludedFiles,
    });

    logger.info('Archived session project', { id: project.id, sessions: project.sessions.length });
  }

  const manifest: Manifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    toolVersion: getToolVersion(),
    createdAt: new Date().toISOString(),
    source: {
      platform: machine.platform,
      architecture: machine.architecture,
      hostname: options.includeHostname ? machine.hostname : 'redacted',
      homeDirectory: machine.homeDirectory,
    },
    projects: projectEntries,
    sessionProjects: sessionEntries,
  };

  zip.addFile('manifest.json', Buffer.from(serializeManifest(manifest), 'utf8'));
  zip.addFile('checksums.json', Buffer.from(JSON.stringify(checksums, null, 2), 'utf8'));

  if (!options.compress) {
    for (const entry of zip.getEntries()) {
      entry.header.method = 0; // STORE
    }
  }

  await new Promise<void>((resolve, reject) => {
    zip.writeZip(path.resolve(options.destinationFile), (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  const stat = await fs.stat(options.destinationFile);

  return { manifest, fileCount, archiveSizeBytes: stat.size };
}
