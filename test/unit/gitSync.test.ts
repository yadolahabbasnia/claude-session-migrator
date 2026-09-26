import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureRepoAtPath, GitSyncError, WrongRepositoryError } from '../../src/utils/gitSync';

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
