import AdmZip = require('adm-zip');
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InvalidArchiveError, ChecksumMismatchError } from '../utils/errors';
import { parseManifest } from './manifest';
import { sha256Buffer, type ChecksumMap } from './checksum';
import { ensureDir } from '../utils/filesystem';
import { createPeriodicYielder } from '../utils/async';
import type { Manifest } from '../models/manifest';

export interface FileProgress {
  processed: number;
  total: number;
  fileName: string;
}

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

/** Verifies every archived file's SHA-256 digest against checksums.json. Used as a fast,
 * extraction-free pre-check (e.g. right after opening a `.cmt`, before the user even picks what
 * to import) -- so it necessarily decompresses everything under the prefix once. */
export async function verifyChecksums(
  archive: OpenedArchive,
  archivePathPrefix: string,
  onProgress?: (p: FileProgress) => void,
): Promise<ChecksumVerificationResult> {
  const mismatched: string[] = [];
  const missing: string[] = [];
  const entries = Object.entries(archive.checksums).filter(([p]) => p.startsWith(archivePathPrefix));
  const yieldPeriodically = createPeriodicYielder();

  let processed = 0;
  for (const [archivePath, expectedHash] of entries) {
    const entry = archive.zip.getEntry(archivePath);
    if (!entry) {
      missing.push(archivePath);
    } else if (sha256Buffer(entry.getData()) !== expectedHash) {
      mismatched.push(archivePath);
    }
    processed += 1;
    onProgress?.({ processed, total: entries.length, fileName: archivePath });
    await yieldPeriodically();
  }

  return { ok: mismatched.length === 0 && missing.length === 0, mismatched, missing };
}

/**
 * Extracts every archived file under `archivePathPrefix` into a staging directory (a temp
 * folder), preserving relative structure. Each entry is decompressed exactly once (hashed and
 * written in the same pass) and checked against checksums.json; a mismatch on any file aborts
 * before the wizard proceeds any further (the staging directory is a temp dir the caller cleans
 * up regardless, so partially-written staging content on failure is harmless).
 */
async function extractPrefixToStaging(
  archive: OpenedArchive,
  archivePathPrefix: string,
  stagingDir: string,
  onProgress?: (p: FileProgress) => void,
): Promise<{ fileCount: number }> {
  const entries = archive.zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.startsWith(archivePathPrefix));

  // Catches an entry that's listed in checksums.json but entirely absent from the zip -- a
  // decompression-free check, so it's cheap to do before the expensive per-file pass below.
  const foundNames = new Set(entries.map((e) => e.entryName));
  for (const expectedPath of Object.keys(archive.checksums)) {
    if (expectedPath.startsWith(archivePathPrefix) && !foundNames.has(expectedPath)) {
      throw new ChecksumMismatchError(expectedPath);
    }
  }

  await ensureDir(stagingDir);
  const yieldPeriodically = createPeriodicYielder();
  let processed = 0;

  for (const entry of entries) {
    const relative = entry.entryName.slice(archivePathPrefix.length);
    const data = entry.getData(); // decompressed exactly once
    const expectedHash = archive.checksums[entry.entryName];
    if (expectedHash && sha256Buffer(data) !== expectedHash) {
      throw new ChecksumMismatchError(entry.entryName);
    }
    const destPath = resolveSafeExtractionPath(stagingDir, relative);
    await ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, data);
    processed += 1;
    onProgress?.({ processed, total: entries.length, fileName: relative });
    await yieldPeriodically();
  }

  return { fileCount: processed };
}

/** Extracts a single archived project's `.claude` contents into a staging directory. */
export async function extractProjectToStaging(
  archive: OpenedArchive,
  projectId: string,
  stagingDir: string,
  onProgress?: (p: FileProgress) => void,
): Promise<{ fileCount: number }> {
  return extractPrefixToStaging(archive, `projects/${projectId}/claude/`, stagingDir, onProgress);
}

/** Extracts a single archived Claude Code session-project's contents into a staging directory. */
export async function extractSessionProjectToStaging(
  archive: OpenedArchive,
  sessionProjectId: string,
  stagingDir: string,
  onProgress?: (p: FileProgress) => void,
): Promise<{ fileCount: number }> {
  return extractPrefixToStaging(archive, `sessions/${sessionProjectId}/data/`, stagingDir, onProgress);
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
