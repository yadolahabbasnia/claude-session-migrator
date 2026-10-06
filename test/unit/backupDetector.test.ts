import { describe, expect, it } from 'vitest';
import { detectSessionBackupCandidates, isBackupFolderName, parseBackupTimestamp } from '../../src/discovery/backupDetector';

describe('isBackupFolderName', () => {
  it('matches the exact shape migrationEngine.createBackup produces', () => {
    expect(isBackupFolderName('-home-user-my-api.backup-2026-10-05T10-44-27-529Z')).toBe(true);
  });

  it('does not match an ordinary project folder', () => {
    expect(isBackupFolderName('-home-user-my-api')).toBe(false);
  });

  it('does not match a folder that merely contains the word "backup"', () => {
    expect(isBackupFolderName('-home-user-my-backup-tool')).toBe(false);
  });
});

describe('detectSessionBackupCandidates', () => {
  const sessionsRoot = '/home/user/.claude/projects';

  it('pairs a backup folder with its still-present live counterpart', () => {
    const folderNames = [
      '-home-user-my-api',
      '-home-user-my-api.backup-2026-10-05T10-44-27-529Z',
      '-home-user-other-project',
    ];

    const candidates = detectSessionBackupCandidates(sessionsRoot, folderNames);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      backupFolderName: '-home-user-my-api.backup-2026-10-05T10-44-27-529Z',
      liveFolderName: '-home-user-my-api',
      backupTimestamp: '2026-10-05T10-44-27-529Z',
    });
  });

  it('ignores an orphaned backup whose live folder no longer exists', () => {
    const folderNames = ['-home-user-my-api.backup-2026-10-05T10-44-27-529Z'];

    expect(detectSessionBackupCandidates(sessionsRoot, folderNames)).toHaveLength(0);
  });

  it('finds every matching pair when there are several', () => {
    const folderNames = [
      'proj-a',
      'proj-a.backup-2026-10-05T10-44-27-529Z',
      'proj-b',
      'proj-b.backup-2026-01-01T00-00-00-000Z',
    ];

    expect(detectSessionBackupCandidates(sessionsRoot, folderNames)).toHaveLength(2);
  });
});

describe('parseBackupTimestamp', () => {
  it('round-trips the dash-encoded timestamp back into a real Date', () => {
    const parsed = parseBackupTimestamp('2026-10-05T10-44-27-529Z');
    expect(parsed?.toISOString()).toBe('2026-10-05T10:44:27.529Z');
  });

  it('returns undefined for garbage input', () => {
    expect(parseBackupTimestamp('not-a-timestamp')).toBeUndefined();
  });
});
