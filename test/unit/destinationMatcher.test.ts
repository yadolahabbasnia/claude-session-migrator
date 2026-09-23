import { describe, expect, it } from 'vitest';
import { matchDestination } from '../../src/migration/destinationMatcher';
import type { ManifestProjectEntry } from '../../src/models/manifest';

function entry(overrides: Partial<ManifestProjectEntry> = {}): ManifestProjectEntry {
  return {
    id: 'id-1',
    name: 'my-api',
    sourcePath: '/Users/alice/dev/my-api',
    claudePath: '/Users/alice/dev/my-api/.claude',
    fileCount: 3,
    sizeBytes: 100,
    excludedFiles: [],
    ...overrides,
  };
}

describe('matchDestination', () => {
  it('matches by git remote with high confidence, even across protocols', () => {
    const project = entry({ git: { repoRoot: '/x', remoteUrls: ['git@github.com:acme/my-api.git'] } });
    const result = matchDestination(project, [
      { path: 'D:\\Work\\my-api', name: 'my-api', remoteUrls: ['https://github.com/acme/my-api.git'] },
    ]);
    expect(result.confidence).toBe('high');
    expect(result.matchedBy).toBe('git-remote');
    expect(result.destinationPath).toBe('D:\\Work\\my-api');
  });

  it('matches an existing folder with the same name and a .claude directory with high confidence', () => {
    const project = entry({ name: 'backend' });
    const result = matchDestination(project, [
      { path: '/home/bob/backend', name: 'backend', hasClaudeDir: true },
    ]);
    expect(result.confidence).toBe('high');
    expect(result.matchedBy).toBe('existing-claude');
  });

  it('matches an existing folder by name alone with medium confidence', () => {
    const project = entry({ name: 'backend' });
    const result = matchDestination(project, [{ path: '/home/bob/backend', name: 'backend' }]);
    expect(result.confidence).toBe('medium');
    expect(result.matchedBy).toBe('existing-folder-name');
  });

  it('matches the single open workspace folder when nothing else is a candidate', () => {
    const project = entry({ name: 'totally-different-name' });
    const result = matchDestination(project, [
      { path: '/home/bob/workdir', name: 'workdir', isCurrentWorkspaceFolder: true },
    ]);
    expect(result.confidence).toBe('medium');
    expect(result.matchedBy).toBe('current-workspace');
  });

  it('returns no match when there are multiple ambiguous candidates', () => {
    const project = entry({ name: 'totally-different-name' });
    const result = matchDestination(project, [
      { path: '/home/bob/a', name: 'a', isCurrentWorkspaceFolder: true },
      { path: '/home/bob/b', name: 'b', isCurrentWorkspaceFolder: true },
    ]);
    expect(result.confidence).toBe('none');
    expect(result.destinationPath).toBeUndefined();
  });

  it('never guesses when there are no candidates at all', () => {
    const project = entry();
    const result = matchDestination(project, []);
    expect(result.confidence).toBe('none');
  });
});
