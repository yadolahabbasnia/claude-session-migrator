import AdmZip = require('adm-zip');
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InvalidArchiveError, ChecksumMismatchError } from '../utils/errors';
import { parseManifest } from './manifest';
import { sha256Buffer, type ChecksumMap } from './checksum';
import { ensureDir } from '../utils/filesystem';
import type { Manifest } from '../models/manifest';

export interface OpenedArchive {
  manifest: Manifest;
  checksums: ChecksumMap;
  zip: AdmZip;
}

export function openArchive(archiveFile: string): OpenedArchive {
  let zip: AdmZip;
  try {
    zip = new AdmZip(archiveFile);
  } catch (err) {
    throw new InvalidArchiveError(`Unable to read archive: ${(err as Error).message}`);
  }

  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    throw new InvalidArchiveError('Archive is missing manifest.json.');
  }
  const manifest = parseManifest(manifestEntry.getData().toString('utf8'));

  const checksumsEntry = zip.getEntry('checksums.json');
  if (!checksumsEntry) {
    throw new InvalidArchiveError('Archive is missing checksums.json.');
  }
  let checksums: ChecksumMap;
  try {
    checksums = JSON.parse(checksumsEntry.getData().toString('utf8'));
  } catch {
    throw new InvalidArchiveError('checksums.json is not valid JSON.');
  }

  return { manifest, checksums, zip };
}

export interface ChecksumVerificationResult {
  ok: boolean;
  mismatched: string[];
  missing: string[];
}

/** Verifies every archived file's SHA-256 digest against checksums.json before extraction. */
export function verifyChecksums(archive: OpenedArchive, archivePathPrefix: string): ChecksumVerificationResult {
  const mismatched: string[] = [];
  const missing: string[] = [];

  for (const [archivePath, expectedHash] of Object.entries(archive.checksums)) {
    if (!archivePath.startsWith(archivePathPrefix)) {
      continue;
    }
    const entry = archive.zip.getEntry(archivePath);
    if (!entry) {
      missing.push(archivePath);
      continue;
    }
    const actualHash = sha256Buffer(entry.getData());
    if (actualHash !== expectedHash) {
      mismatched.push(archivePath);
    }
  }

  return { ok: mismatched.length === 0 && missing.length === 0, mismatched, missing };
}

/**
 * Extracts every archived file under `archivePathPrefix` into a staging directory (a temp
 * folder), preserving relative structure. Verifies checksums first and throws before writing
 * anything if verification fails.
 */
async function extractPrefixToStaging(
  archive: OpenedArchive,
  archivePathPrefix: string,
  stagingDir: string,
): Promise<{ fileCount: number }> {
  const verification = verifyChecksums(archive, archivePathPrefix);
  if (!verification.ok) {
    const badFile = verification.mismatched[0] ?? verification.missing[0];
    throw new ChecksumMismatchError(badFile);
  }

  await ensureDir(stagingDir);
  let fileCount = 0;
  for (const entry of archive.zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(archivePathPrefix)) {
      continue;
    }
    const relative = entry.entryName.slice(archivePathPrefix.length);
    const destPath = resolveSafeExtractionPath(stagingDir, relative);
    await ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, entry.getData());
    fileCount += 1;
  }

  return { fileCount };
}

/** Extracts a single archived project's `.claude` contents into a staging directory. */
export async function extractProjectToStaging(
  archive: OpenedArchive,
  projectId: string,
  stagingDir: string,
): Promise<{ fileCount: number }> {
  return extractPrefixToStaging(archive, `projects/${projectId}/claude/`, stagingDir);
}

/** Extracts a single archived Claude Code session-project's contents into a staging directory. */
export async function extractSessionProjectToStaging(
  archive: OpenedArchive,
  sessionProjectId: string,
  stagingDir: string,
): Promise<{ fileCount: number }> {
  return extractPrefixToStaging(archive, `sessions/${sessionProjectId}/data/`, stagingDir);
}

/** Guards against zip-slip: rejects any entry that would escape the staging directory. */
function resolveSafeExtractionPath(baseDir: string, relativeEntryPath: string): string {
  const segments = relativeEntryPath.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) {
    throw new InvalidArchiveError(`Archive entry has an unsafe path: ${relativeEntryPath}`);
  }
  const resolved = path.join(baseDir, ...segments);
  const resolvedBase = path.resolve(baseDir);
  if (!path.resolve(resolved).startsWith(resolvedBase + path.sep) && path.resolve(resolved) !== resolvedBase) {
    throw new InvalidArchiveError(`Archive entry escapes staging directory: ${relativeEntryPath}`);
  }
  return resolved;
}
