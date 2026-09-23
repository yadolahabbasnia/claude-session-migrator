import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { scanProjectReferences } from '../../src/migration/referenceScanner';
import type { PathContext } from '../../src/migration/pathResolver';

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'projects');

describe('scanProjectReferences', () => {
  it('finds project-root and unrelated references in project-a without modifying anything', async () => {
    // The fixture's .claude files contain literal fake source-machine paths (e.g.
    // "/Users/alice/dev/project-a") that are independent of where this fixture actually lives
    // on disk during the test run -- the context must describe that fake machine, not this one.
    const context: PathContext = {
      projectRoot: '/Users/alice/dev/project-a',
      homeDir: '/Users/alice',
      workspaceRoot: '/Users/alice/dev/project-a',
      style: 'posix',
    };
    const refs = await scanProjectReferences(path.join(FIXTURE_ROOT, 'project-a', '.claude'), context);

    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => r.kind === 'project-root')).toBe(true);
    expect(refs.some((r) => r.kind === 'absolute-unclassified')).toBe(true);
    expect(refs.every((r) => r.file.length > 0 && r.line > 0)).toBe(true);
  });

  it('finds no references in project-b, which has none', async () => {
    const context: PathContext = {
      projectRoot: path.join(FIXTURE_ROOT, 'project-b'),
      homeDir: '/Users/bob',
      workspaceRoot: path.join(FIXTURE_ROOT, 'project-b'),
      style: 'posix',
    };
    const refs = await scanProjectReferences(path.join(FIXTURE_ROOT, 'project-b', '.claude'), context);
    expect(refs).toHaveLength(0);
  });
});
