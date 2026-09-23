import { MANIFEST_FORMAT_VERSION, isManifest, type Manifest } from '../models/manifest';
import { InvalidArchiveError, UnsupportedFormatVersionError } from '../utils/errors';

/** package.json version, inlined at build time is unnecessary for an MVP -- read lazily. */
export function getToolVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function parseManifest(raw: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InvalidArchiveError(`manifest.json is not valid JSON: ${(err as Error).message}`);
  }
  if (!isManifest(parsed)) {
    throw new InvalidArchiveError('manifest.json is missing required fields.');
  }
  if (parsed.formatVersion > MANIFEST_FORMAT_VERSION) {
    throw new UnsupportedFormatVersionError(parsed.formatVersion, MANIFEST_FORMAT_VERSION);
  }
  // Archives written before session support existed simply won't have this key.
  if (!Array.isArray(parsed.sessionProjects)) {
    parsed.sessionProjects = [];
  }
  return parsed;
}

export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2);
}
