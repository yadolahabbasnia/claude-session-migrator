import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeSessionBackupIntoLive } from '../../src/migration/sessionMerger';

describe('mergeSessionBackupIntoLive', () => {
  let tempRoot: string;
  let backupDir: string;
  let liveDir: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-session-merge-test-'));
    backupDir = path.join(tempRoot, 'proj.backup-2026-10-05T10-44-27-529Z');
    liveDir = path.join(tempRoot, 'proj');
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(liveDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('copies a session that only exists in the backup into the live folder', async () => {
    await fs.writeFile(path.join(backupDir, 'session-a.jsonl'), '{"old":true}\n');

    const result = await mergeSessionBackupIntoLive({ backupFolderPath: backupDir, liveFolderPath: liveDir });

    expect(result.copiedSessions).toEqual(['session-a.jsonl']);
    expect(result.skippedExistingSessions).toEqual([]);
    await expect(fs.readFile(path.join(liveDir, 'session-a.jsonl'), 'utf8')).resolves.toBe('{"old":true}\n');
  });

  it('never overwrites a session that already exists live, even if content differs', async () => {
    await fs.writeFile(path.join(backupDir, 'session-a.jsonl'), '{"from":"backup"}\n');
    await fs.writeFile(path.join(liveDir, 'session-a.jsonl'), '{"from":"live"}\n');

    const result = await mergeSessionBackupIntoLive({ backupFolderPath: backupDir, liveFolderPath: liveDir });

    expect(result.copiedSessions).toEqual([]);
    expect(result.skippedExistingSessions).toEqual(['session-a.jsonl']);
    await expect(fs.readFile(path.join(liveDir, 'session-a.jsonl'), 'utf8')).resolves.toBe('{"from":"live"}\n');
  });

  it('ignores non-.jsonl files in the backup folder', async () => {
    await fs.writeFile(path.join(backupDir, '.DS_Store'), 'junk');

    const result = await mergeSessionBackupIntoLive({ backupFolderPath: backupDir, liveFolderPath: liveDir });

    expect(result.copiedSessions).toEqual([]);
    await expect(fs.readdir(liveDir)).resolves.toEqual([]);
  });

  it('merges memory/ files that are missing live, without touching ones that already exist', async () => {
    await fs.mkdir(path.join(backupDir, 'memory', 'nested'), { recursive: true });
    await fs.writeFile(path.join(backupDir, 'memory', 'notes.md'), 'backup notes');
    await fs.writeFile(path.join(backupDir, 'memory', 'nested', 'extra.md'), 'nested backup notes');
    await fs.mkdir(path.join(liveDir, 'memory'), { recursive: true });
    await fs.writeFile(path.join(liveDir, 'memory', 'notes.md'), 'live notes');

    const result = await mergeSessionBackupIntoLive({ backupFolderPath: backupDir, liveFolderPath: liveDir });

    expect(result.copiedMemoryFiles).toEqual(['nested/extra.md']);
    expect(result.skippedExistingMemoryFiles).toEqual(['notes.md']);
    await expect(fs.readFile(path.join(liveDir, 'memory', 'notes.md'), 'utf8')).resolves.toBe('live notes');
    await expect(fs.readFile(path.join(liveDir, 'memory', 'nested', 'extra.md'), 'utf8')).resolves.toBe(
      'nested backup notes',
    );
  });
});
