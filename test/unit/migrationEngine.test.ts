import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { applyMigration } from '../../src/migration/migrationEngine';
import { buildMigrationPreview } from '../../src/migration/migrationPlan';
import type { PathContext } from '../../src/migration/pathResolver';

const source: PathContext = {
  projectRoot: '/Users/alice/dev/my-api',
  homeDir: '/Users/alice',
  workspaceRoot: '/Users/alice/dev/my-api',
  style: 'posix',
};

describe('applyMigration', () => {
  let tempDir: string;
  let stagedContentDir: string;
  let destinationPath: string;
  let destClaudeDir: string;
  let dest: PathContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-apply-test-'));
    stagedContentDir = path.join(tempDir, 'staged');
    destinationPath = path.join(tempDir, 'dest-project');
    destClaudeDir = path.join(destinationPath, '.claude');
    await fs.mkdir(stagedContentDir, { recursive: true });
    await fs.mkdir(destinationPath, { recursive: true });
    dest = {
      projectRoot: destinationPath,
      homeDir: os.homedir(),
      workspaceRoot: destinationPath,
      style: process.platform === 'win32' ? 'win32' : 'posix',
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes files fresh when there is no existing .claude', async () => {
    await fs.writeFile(path.join(stagedContentDir, 'settings.json'), '{"a":1}');
    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    const result = await applyMigration({
      preview,
      stagedContentDir,
      strategy: 'backup-and-replace',
      sourceContext: source,
      destContext: dest,
    });

    expect(result.backupPath).toBeUndefined();
    expect(result.filesWritten).toBe(1);
    const written = await fs.readFile(path.join(destClaudeDir, 'settings.json'), 'utf8');
    expect(written).toBe('{"a":1}');
  });

  it('backs up an existing .claude before replacing it', async () => {
    await fs.mkdir(destClaudeDir, { recursive: true });
    await fs.writeFile(path.join(destClaudeDir, 'old.txt'), 'old data');
    await fs.writeFile(path.join(stagedContentDir, 'new.txt'), 'new data');

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    const result = await applyMigration({
      preview,
      stagedContentDir,
      strategy: 'backup-and-replace',
      sourceContext: source,
      destContext: dest,
    });

    expect(result.backupPath).toBeDefined();
    const backedUp = await fs.readFile(path.join(result.backupPath!, 'old.txt'), 'utf8');
    expect(backedUp).toBe('old data');
    // Replace strategy removes files not present in the new archive.
    await expect(fs.readFile(path.join(destClaudeDir, 'old.txt'), 'utf8')).rejects.toThrow();
    const newFile = await fs.readFile(path.join(destClaudeDir, 'new.txt'), 'utf8');
    expect(newFile).toBe('new data');
  });

  it('merge strategy preserves untouched existing files and only overlays new ones', async () => {
    await fs.mkdir(destClaudeDir, { recursive: true });
    await fs.writeFile(path.join(destClaudeDir, 'keep-me.txt'), 'keep this');
    await fs.writeFile(path.join(stagedContentDir, 'incoming.txt'), 'incoming data');

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    const result = await applyMigration({
      preview,
      stagedContentDir,
      strategy: 'merge',
      sourceContext: source,
      destContext: dest,
    });

    expect(result.backupPath).toBeDefined();
    const kept = await fs.readFile(path.join(destClaudeDir, 'keep-me.txt'), 'utf8');
    expect(kept).toBe('keep this');
    const incoming = await fs.readFile(path.join(destClaudeDir, 'incoming.txt'), 'utf8');
    expect(incoming).toBe('incoming data');
  });

  it('skip strategy leaves the destination completely untouched', async () => {
    await fs.mkdir(destClaudeDir, { recursive: true });
    await fs.writeFile(path.join(destClaudeDir, 'old.txt'), 'old data');
    await fs.writeFile(path.join(stagedContentDir, 'new.txt'), 'new data');

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    const result = await applyMigration({
      preview,
      stagedContentDir,
      strategy: 'skip',
      sourceContext: source,
      destContext: dest,
    });

    expect(result.filesWritten).toBe(0);
    await expect(fs.readFile(path.join(destClaudeDir, 'new.txt'), 'utf8')).rejects.toThrow();
    const old = await fs.readFile(path.join(destClaudeDir, 'old.txt'), 'utf8');
    expect(old).toBe('old data');
  });

  it('rolls back to the pre-migration backup if a write fails partway through a merge', async () => {
    await fs.mkdir(destClaudeDir, { recursive: true });
    await fs.writeFile(path.join(destClaudeDir, 'keep-me.txt'), 'keep this');
    // "blocked" exists as a *file* at the destination; the staged archive wants to write a
    // file underneath a same-named directory, which cannot succeed (ENOTDIR).
    await fs.writeFile(path.join(destClaudeDir, 'blocked'), 'i am a file, not a directory');
    await fs.mkdir(path.join(stagedContentDir, 'blocked'), { recursive: true });
    await fs.writeFile(path.join(stagedContentDir, 'blocked', 'nested.txt'), 'this write should fail');

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    await expect(
      applyMigration({
        preview,
        stagedContentDir,
        strategy: 'merge',
        sourceContext: source,
        destContext: dest,
      }),
    ).rejects.toThrow();

    // After rollback, the original files must be exactly as they were before the failed apply.
    const kept = await fs.readFile(path.join(destClaudeDir, 'keep-me.txt'), 'utf8');
    expect(kept).toBe('keep this');
    const blocked = await fs.readFile(path.join(destClaudeDir, 'blocked'), 'utf8');
    expect(blocked).toBe('i am a file, not a directory');
  });
});
