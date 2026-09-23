import { openArchive, verifyChecksums, type OpenedArchive } from '../archive/archiveReader';
import { MANIFEST_FORMAT_VERSION } from '../models/manifest';
import { InvalidArchiveError } from '../utils/errors';

export interface ArchiveValidationResult {
  ok: boolean;
  archive?: OpenedArchive;
  errors: string[];
  warnings: string[];
  formatVersion?: number;
}

/** Validates a .cmt archive is readable, has a supported manifest, and passes checksum
 * verification, without extracting anything. */
export function validateArchive(archiveFile: string): ArchiveValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let archive: OpenedArchive;
  try {
    archive = openArchive(archiveFile);
  } catch (err) {
    errors.push(err instanceof InvalidArchiveError ? err.message : `Failed to open archive: ${String(err)}`);
    return { ok: false, errors, warnings };
  }

  if (archive.manifest.formatVersion > MANIFEST_FORMAT_VERSION) {
    errors.push(
      `Archive format version ${archive.manifest.formatVersion} is newer than supported (${MANIFEST_FORMAT_VERSION}).`,
    );
  }

  if (archive.manifest.projects.length === 0 && archive.manifest.sessionProjects.length === 0) {
    warnings.push('Archive contains no projects and no sessions.');
  }

  for (const project of archive.manifest.projects) {
    const verification = verifyChecksums(archive, `projects/${project.id}/claude/`);
    if (!verification.ok) {
      errors.push(
        `Checksum verification failed for project "${project.name}": ${
          [...verification.mismatched, ...verification.missing].slice(0, 5).join(', ')
        }`,
      );
    }
  }

  for (const sessionProject of archive.manifest.sessionProjects) {
    const verification = verifyChecksums(archive, `sessions/${sessionProject.id}/data/`);
    if (!verification.ok) {
      errors.push(
        `Checksum verification failed for session project "${sessionProject.folderName}": ${
          [...verification.mismatched, ...verification.missing].slice(0, 5).join(', ')
        }`,
      );
    }
  }

  return { ok: errors.length === 0, archive, errors, warnings, formatVersion: archive.manifest.formatVersion };
}
