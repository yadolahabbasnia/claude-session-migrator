import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitAndPush,
  ensureRepoAtPath,
  getRepoStatus,
  GitSyncError,
  isSuspiciousShrink,
  listSyncArchives,
  machineArchiveFileName,
  pull,
  WrongRepositoryError,
} from '../../src/utils/gitSync';

const execFileAsync = promisify(execFile);

async function initLocalRepoWithRemote(dir: string, remoteUrl: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir });
}

describe('ensureRepoAtPath', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-git-sync-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('accepts a local checkout whose remote matches the configured repo URL', async () => {
    const localPath = path.join(tempRoot, 'repo');
    await initLocalRepoWithRemote(localPath, 'git@github.com:acme/claude-sessions.git');

    await expect(
      ensureRepoAtPath(localPath, 'https://github.com/acme/claude-sessions.git', 'main'),
    ).resolves.toBeUndefined();
  });

  it('refuses to sync when the local checkout points at a different repository', async () => {
    const localPath = path.join(tempRoot, 'repo');
    await initLocalRepoWithRemote(localPath, 'git@github.com:acme/some-other-repo.git');

    await expect(
      ensureRepoAtPath(localPath, 'https://github.com/acme/claude-sessions.git', 'main'),
    ).rejects.toThrow(WrongRepositoryError);
  });

  it('refuses a non-empty folder that is not a git repository at all', async () => {
    const localPath = path.join(tempRoot, 'not-a-repo');
    await fs.mkdir(localPath, { recursive: true });
    await fs.writeFile(path.join(localPath, 'something.txt'), 'hello');

    await expect(
      ensureRepoAtPath(localPath, 'https://github.com/acme/claude-sessions.git', 'main'),
    ).rejects.toThrow(GitSyncError);
  });
});

describe('machine archives and two-machine sync', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-git-sync-two-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('gives each machine its own archive file name', () => {
    expect(machineArchiveFileName('claude-sessions.cmt', 'My-PC.local')).toBe('claude-sessions-my-pc-local.cmt');
  });

  it('flags only a large drop in archive size', () => {
    expect(isSuspiciousShrink(175 * 1024 * 1024, 175 * 1024)).toBe(true);
    expect(isSuspiciousShrink(175 * 1024 * 1024, 150 * 1024 * 1024)).toBe(false);
    expect(isSuspiciousShrink(undefined, 10)).toBe(false);
    expect(isSuspiciousShrink(2000, 10)).toBe(false);
  });

  it('lets machine B see what machine A pushed, and A see B afterwards, without clobbering', async () => {
    const remote = path.join(tempRoot, 'remote.git');
    await execFileAsync('git', ['init', '--bare', '-b', 'main', remote]);
    const url = `file://${remote}`;
    const a = path.join(tempRoot, 'a');
    const b = path.join(tempRoot, 'b');

    await ensureRepoAtPath(a, url, 'main');
    await execFileAsync('git', ['config', 'user.name', 't'], { cwd: a });
    await execFileAsync('git', ['config', 'user.email', 't@t'], { cwd: a });
    await pull(a, 'main');
    await fs.writeFile(path.join(a, 'claude-sessions-a.cmt'), 'archive from A');
    expect(await commitAndPush(a, 'main', 'A pushes')).toBe(true);

    await ensureRepoAtPath(b, url, 'main');
    await execFileAsync('git', ['config', 'user.name', 't'], { cwd: b });
    await execFileAsync('git', ['config', 'user.email', 't@t'], { cwd: b });
    await pull(b, 'main');
    expect((await listSyncArchives(b)).map((x) => x.fileName)).toEqual(['claude-sessions-a.cmt']);

    await fs.writeFile(path.join(b, 'claude-sessions-b.cmt'), 'archive from B');
    expect(await commitAndPush(b, 'main', 'B pushes')).toBe(true);

    // A pushes again while B's commit is already on the remote: push must rebase, not fail.
    await fs.writeFile(path.join(a, 'claude-sessions-a.cmt'), 'archive from A, newer');
    expect(await commitAndPush(a, 'main', 'A pushes again')).toBe(true);
    await pull(a, 'main');

    const names = (await listSyncArchives(a)).map((x) => x.fileName).sort();
    expect(names).toEqual(['claude-sessions-a.cmt', 'claude-sessions-b.cmt']);
  });

  it('reports last commit, uncommitted files and ahead/behind for the sidebar', async () => {
    const remote = path.join(tempRoot, 'remote.git');
    await execFileAsync('git', ['init', '--bare', '-b', 'main', remote]);
    const a = path.join(tempRoot, 'a');
    await ensureRepoAtPath(a, `file://${remote}`, 'main');
    await execFileAsync('git', ['config', 'user.name', 't'], { cwd: a });
    await execFileAsync('git', ['config', 'user.email', 't@t'], { cwd: a });
    await pull(a, 'main');

    expect(await getRepoStatus(path.join(tempRoot, 'missing'), 'main')).toBeUndefined();

    await fs.writeFile(path.join(a, 'one.cmt'), '1');
    await commitAndPush(a, 'main', 'first push');
    await fs.writeFile(path.join(a, 'two.cmt'), '2');

    const status = await getRepoStatus(a, 'main');
    expect(status?.lastCommit?.subject).toBe('first push');
    expect(status?.uncommittedFiles).toBe(1);
    expect(status?.ahead).toBe(0);
    expect(status?.behind).toBe(0);
  });
});
