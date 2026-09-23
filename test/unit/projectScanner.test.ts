import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanForProjects, computeProjectId } from '../../src/discovery/projectScanner';

async function makeClaudeProject(root: string, relativeDir: string): Promise<void> {
  const claudeDir = path.join(root, relativeDir, '.claude');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(path.join(claudeDir, 'settings.json'), '{}');
}

describe('scanForProjects', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-scan-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('finds a single top-level project', async () => {
    await makeClaudeProject(tempDir, 'my-api');
    const projects = await scanForProjects([tempDir]);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('my-api');
  });

  it('finds nested projects (a project inside another project)', async () => {
    await makeClaudeProject(tempDir, 'outer');
    await makeClaudeProject(tempDir, path.join('outer', 'packages', 'inner'));
    const projects = await scanForProjects([tempDir]);
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(['inner', 'outer']);
  });

  it('does not descend into ignored directories like node_modules', async () => {
    await makeClaudeProject(tempDir, 'app');
    await makeClaudeProject(tempDir, path.join('app', 'node_modules', 'some-dep'));
    const projects = await scanForProjects([tempDir]);
    const names = projects.map((p) => p.name);
    expect(names).toContain('app');
    expect(names).not.toContain('some-dep');
  });

  it('does not descend into .git internals', async () => {
    await makeClaudeProject(tempDir, 'app');
    await fs.mkdir(path.join(tempDir, 'app', '.git', 'objects'), { recursive: true });
    const projects = await scanForProjects([tempDir]);
    expect(projects).toHaveLength(1);
  });

  it('prevents symlink loops from causing infinite recursion', async () => {
    await makeClaudeProject(tempDir, 'app');
    const loopTarget = path.join(tempDir, 'app');
    const loopLink = path.join(tempDir, 'app', 'loop-back');
    try {
      await fs.symlink(loopTarget, loopLink, 'dir');
    } catch {
      return; // Symlinks may be unavailable/unpermitted in some sandboxes; skip gracefully.
    }
    const projects = await scanForProjects([tempDir], { maxDepth: 20 });
    expect(projects).toHaveLength(1);
  });

  it('handles permission errors gracefully without throwing', async () => {
    await makeClaudeProject(tempDir, 'app');
    const restrictedDir = path.join(tempDir, 'restricted');
    await fs.mkdir(restrictedDir);
    await fs.writeFile(path.join(restrictedDir, 'x'), 'x');
    try {
      await fs.chmod(restrictedDir, 0o000);
    } catch {
      return; // chmod may be a no-op when running as root; skip in that environment.
    }
    try {
      await expect(scanForProjects([tempDir])).resolves.toBeDefined();
    } finally {
      await fs.chmod(restrictedDir, 0o755);
    }
  });

  it('respects the max depth limit', async () => {
    await makeClaudeProject(tempDir, path.join('a', 'b', 'c', 'd', 'deep'));
    const shallow = await scanForProjects([tempDir], { maxDepth: 2 });
    expect(shallow).toHaveLength(0);
    const deep = await scanForProjects([tempDir], { maxDepth: 10 });
    expect(deep).toHaveLength(1);
  });
});

describe('computeProjectId', () => {
  it('produces the same id for equivalent git remote URLs regardless of protocol', () => {
    const a = computeProjectId('/Users/alice/dev/my-api', ['git@github.com:acme/my-api.git']);
    const b = computeProjectId('D:\\Work\\my-api', ['https://github.com/acme/my-api.git']);
    expect(a).toBe(b);
  });

  it('falls back to a path-derived id when there is no git remote', () => {
    const id = computeProjectId('/Users/alice/dev/my-api', undefined);
    expect(id.startsWith('path:')).toBe(true);
  });

  it('produces different fallback ids for differently-named projects', () => {
    const a = computeProjectId('/Users/alice/dev/my-api', undefined);
    const b = computeProjectId('/Users/alice/dev/other-api', undefined);
    expect(a).not.toBe(b);
  });
});
