import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanSessionProjects, readSessionPreview } from '../../src/discovery/sessionScanner';

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

function assistantLine(timestamp: string, text: string): string {
  return line({
    type: 'assistant',
    timestamp,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

describe('scanSessionProjects', () => {
  let sessionsRoot: string;

  beforeEach(async () => {
    sessionsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-sessions-test-'));
  });

  afterEach(async () => {
    await fs.rm(sessionsRoot, { recursive: true, force: true });
  });

  it('discovers a project folder and reads its true source path from the recorded cwd', async () => {
    const projectDir = path.join(sessionsRoot, '-home-alice-dev-my-api');
    await fs.mkdir(projectDir, { recursive: true });
    const content =
      userLine('/home/alice/dev/my-api', 'sess-1', 'help me fix this bug', '2026-01-01T00:00:00.000Z') +
      assistantLine('2026-01-01T00:00:05.000Z', 'Sure, let me look.');
    await fs.writeFile(path.join(projectDir, 'sess-1.jsonl'), content);

    const projects = await scanSessionProjects(sessionsRoot);
    expect(projects).toHaveLength(1);
    expect(projects[0].folderName).toBe('-home-alice-dev-my-api');
    expect(projects[0].sourcePath).toBe('/home/alice/dev/my-api');
    expect(projects[0].sourcePathConfidence).toBe('from-session-cwd');
    expect(projects[0].sessions).toHaveLength(1);
    expect(projects[0].sessions[0].messageCount).toBe(2);
    expect(projects[0].sessions[0].firstUserMessagePreview).toContain('help me fix this bug');
  });

  it('ignores non-directory entries and directories with no .jsonl files', async () => {
    await fs.writeFile(path.join(sessionsRoot, '.DS_Store'), 'junk');
    await fs.mkdir(path.join(sessionsRoot, 'empty-project'));
    const projects = await scanSessionProjects(sessionsRoot);
    expect(projects).toHaveLength(0);
  });

  it('detects a memory subdirectory and includes it in the total size', async () => {
    const projectDir = path.join(sessionsRoot, '-home-alice-dev-my-api');
    await fs.mkdir(path.join(projectDir, 'memory'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'sess-1.jsonl'), userLine('/x', 's', 'hi', 't'));
    await fs.writeFile(path.join(projectDir, 'memory', 'MEMORY.md'), 'some memory content');

    const projects = await scanSessionProjects(sessionsRoot);
    expect(projects[0].hasMemoryDir).toBe(true);
    expect(projects[0].totalSizeBytes).toBeGreaterThan(
      Buffer.byteLength(userLine('/x', 's', 'hi', 't')),
    );
  });

  it('picks the cwd from the most recently modified session when there are several', async () => {
    const projectDir = path.join(sessionsRoot, 'proj');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'old.jsonl'),
      userLine('/old/path', 'old', 'first session', 't1'),
    );
    // Ensure a distinguishable mtime ordering.
    await new Promise((r) => setTimeout(r, 10));
    await fs.writeFile(
      path.join(projectDir, 'new.jsonl'),
      userLine('/new/path', 'new', 'second session', 't2'),
    );

    const projects = await scanSessionProjects(sessionsRoot);
    expect(projects[0].sourcePath).toBe('/new/path');
  });

  it('returns an empty list when the sessions root does not exist', async () => {
    const projects = await scanSessionProjects(path.join(sessionsRoot, 'does-not-exist'));
    expect(projects).toEqual([]);
  });
});

describe('readSessionPreview', () => {
  it('extracts readable turns from a session file', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-preview-test-'));
    try {
      const filePath = path.join(tempDir, 'sess.jsonl');
      const content =
        userLine('/x', 's', 'first question', 't1') + assistantLine('t2', 'first answer');
      await fs.writeFile(filePath, content);

      const turns = await readSessionPreview(filePath);
      expect(turns).toHaveLength(2);
      expect(turns[0].role).toBe('user');
      expect(turns[0].text).toContain('first question');
      expect(turns[1].role).toBe('assistant');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
