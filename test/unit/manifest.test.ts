import { describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/archive/manifest';
import { MANIFEST_FORMAT_VERSION, isManifest } from '../../src/models/manifest';
import { UnsupportedFormatVersionError, InvalidArchiveError } from '../../src/utils/errors';

function validManifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: MANIFEST_FORMAT_VERSION,
    toolVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    source: { platform: 'darwin', architecture: 'arm64', hostname: 'redacted', homeDirectory: '/Users/alice' },
    projects: [],
    ...overrides,
  });
}

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = parseManifest(validManifestJson());
    expect(manifest.formatVersion).toBe(MANIFEST_FORMAT_VERSION);
    expect(manifest.source.platform).toBe('darwin');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseManifest('{not json')).toThrow(InvalidArchiveError);
  });

  it('rejects a manifest missing required fields', () => {
    expect(() => parseManifest(JSON.stringify({ formatVersion: 1 }))).toThrow(InvalidArchiveError);
  });

  it('rejects an unsupported (future) format version', () => {
    expect(() => parseManifest(validManifestJson({ formatVersion: MANIFEST_FORMAT_VERSION + 1 }))).toThrow(
      UnsupportedFormatVersionError,
    );
  });

  it('defaults sessionProjects to an empty array for archives written before session support existed', () => {
    const manifest = parseManifest(validManifestJson());
    expect(manifest.sessionProjects).toEqual([]);
  });

  it('preserves sessionProjects when present', () => {
    const manifest = parseManifest(
      validManifestJson({
        sessionProjects: [
          { id: 's1', folderName: '-home-alice-dev-my-api', sessionCount: 2, sizeBytes: 100, hasMemoryDir: false, excludedFiles: [] },
        ],
      }),
    );
    expect(manifest.sessionProjects).toHaveLength(1);
  });
});

describe('isManifest', () => {
  it('returns false for non-object values', () => {
    expect(isManifest(null)).toBe(false);
    expect(isManifest('a string')).toBe(false);
    expect(isManifest(42)).toBe(false);
  });

  it('returns false when projects is not an array', () => {
    expect(
      isManifest({
        formatVersion: 1,
        toolVersion: '1',
        createdAt: 'x',
        source: {},
        projects: 'nope',
      }),
    ).toBe(false);
  });
});
