import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runHeadlessSessionsExport } from '../../src/archive/autoExport';
import { openArchive } from '../../src/archive/archiveReader';

function line(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

function userLine(cwd: string, sessionId: string, text: string, timestamp: string): string {
  return line({
    type: 'user',
    cwd,
    sessionId,
    timestamp,
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

describe('runHeadlessSessionsExport', () => {
  let sessionsRoot: string;
  let tempDir: string;
  let destinationFile: string;

  beforeEach(async () => {
    sessionsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-auto-sessions-'));
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-auto-archive-'));
    destinationFile = path.join(tempDir, 'auto-sync.cmt');
  });

  afterEach(async () => {
    await fs.rm(sessionsRoot, { recursive: true, force: true });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns undefined and writes nothing when there are no sessions', async () => {
    const result = await runHeadlessSessionsExport(sessionsRoot, destinationFile);
    expect(result).toBeUndefined();
    await expect(fs.access(destinationFile)).rejects.toThrow();
  });

  it('archives every session project with no user interaction', async () => {
    const projectDir = path.join(sessionsRoot, '-home-alice-dev-my-api');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'sess-1.jsonl'),
      userLine('/home/alice/dev/my-api', 'sess-1', 'help me fix this bug', '2026-01-01T00:00:00.000Z'),
    );

    const result = await runHeadlessSessionsExport(sessionsRoot, destinationFile);

    expect(result).toBeDefined();
    expect(result?.projectCount).toBe(1);
    expect(result?.skippedSecretFiles).toBe(0);

    const archive = openArchive(destinationFile);
    expect(archive.manifest.sessionProjects).toHaveLength(1);
    expect(archive.zip.getEntries().some((e) => e.entryName.endsWith('sess-1.jsonl'))).toBe(true);
  });

  it('silently excludes a file that trips the secret scanner instead of including or prompting', async () => {
    const projectDir = path.join(sessionsRoot, '-home-alice-dev-my-api');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'sess-1.jsonl'),
      userLine('/home/alice/dev/my-api', 'sess-1', 'help me fix this bug', '2026-01-01T00:00:00.000Z'),
    );
    // AWS-style secret key, well inside what the scanner flags.
    await fs.writeFile(
      path.join(projectDir, 'notes.txt'),
      'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n',
    );

    const result = await runHeadlessSessionsExport(sessionsRoot, destinationFile);

    expect(result?.skippedSecretFiles).toBeGreaterThan(0);
    const archive = openArchive(destinationFile);
    const entry = archive.manifest.sessionProjects[0];
    expect(entry.excludedFiles).toContain('notes.txt');
    expect(archive.zip.getEntries().some((e) => e.entryName.endsWith('notes.txt'))).toBe(false);
    expect(archive.zip.getEntries().some((e) => e.entryName.endsWith('sess-1.jsonl'))).toBe(true);
  });
});
