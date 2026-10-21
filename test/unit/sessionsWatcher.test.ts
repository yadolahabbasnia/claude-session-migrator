import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);
const settings = new Map<string, unknown>();

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => (settings.has(key) ? settings.get(key) : fallback) }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  },
  ConfigurationTarget: { Global: 1 },
}));

import { SessionsAutoSyncWatcher } from '../../src/utils/sessionsWatcher';
import { machineArchiveFileName } from '../../src/utils/gitSync';
import { openArchive } from '../../src/archive/archiveReader';

async function realWait(cond: () => Promise<boolean> | boolean, ms = 20_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await new Promise((r) => setImmediate(r));
  }
  return false;
}

async function remoteLog(remote: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['--git-dir', remote, 'log', '--format=%s', 'main']);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function sessionLine(text: string): string {
  return JSON.stringify({ type: 'user', cwd: '/home/u/proj', sessionId: 's1', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
}

describe('SessionsAutoSyncWatcher (real fs + real git)', () => {
  let root: string;
  let remote: string;
  let checkout: string;
  let claudeHome: string;
  let watcher: SessionsAutoSyncWatcher | undefined;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-watcher-'));
    remote = path.join(root, 'remote.git');
    checkout = path.join(root, 'checkout');
    claudeHome = path.join(root, 'claude');
    await fs.mkdir(path.join(claudeHome, 'projects', '-home-u-proj'), { recursive: true });
    await execFileAsync('git', ['init', '--bare', '-b', 'main', remote]);
    Object.assign(process.env, {
      CLAUDE_CONFIG_DIR: claudeHome,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    });
    settings.clear();
    settings.set('gitSync.repoUrl', `file://${remote}`);
    settings.set('gitSync.localPath', checkout);
    settings.set('gitSync.branch', 'main');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(async () => {
    watcher?.dispose();
    watcher = undefined;
    vi.useRealTimers();
    process.env = { ...savedEnv };
    await fs.rm(root, { recursive: true, force: true });
  });

  async function startAndTouch(file: string, content: string): Promise<void> {
    watcher = new SessionsAutoSyncWatcher();
    await new Promise((r) => { const t = Date.now(); const w = () => (Date.now() - t > 400 ? r(undefined) : setImmediate(w)); w(); });
    await fs.writeFile(file, content);
    expect(await realWait(() => vi.getTimerCount() > 0, 5000)).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
  }

  it('pushes a per-machine archive with a new session, redacting (not dropping) secret-like text', async () => {
    settings.set('gitSync.mode', 'git');
    const file = path.join(claudeHome, 'projects', '-home-u-proj', 's1.jsonl');
    await startAndTouch(file, sessionLine('hello there') + sessionLine('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'));

    expect(await realWait(async () => (await remoteLog(remote)).length > 0)).toBe(true);
    expect((await remoteLog(remote))[0]).toMatch(/^Auto-sync Claude sessions from /);

    const archiveName = machineArchiveFileName('claude-sessions.cmt', os.hostname());
    const archivePath = path.join(checkout, archiveName);
    const archive = openArchive(archivePath);
    const entry = archive.zip.getEntries().find((e) => e.entryName.endsWith('s1.jsonl'));
    expect(entry).toBeDefined();
    const text = entry!.getData().toString('utf8');
    expect(text).toContain('hello there');
    expect(text).toContain('[REDACTED:');
    expect(text).not.toContain('wJalrXUtnFEMI');
  });

  it('does nothing while gitSync.mode is local', async () => {
    settings.set('gitSync.mode', 'local');
    watcher = new SessionsAutoSyncWatcher();
    await fs.writeFile(path.join(claudeHome, 'projects', '-home-u-proj', 's1.jsonl'), sessionLine('hi'));
    await new Promise((r) => setImmediate(r));
    expect(vi.getTimerCount()).toBe(0);
    expect(await remoteLog(remote)).toEqual([]);
  });

  it('does nothing when autoSync is disabled', async () => {
    settings.set('gitSync.mode', 'git');
    settings.set('gitSync.autoSync', false);
    watcher = new SessionsAutoSyncWatcher();
    await fs.writeFile(path.join(claudeHome, 'projects', '-home-u-proj', 's1.jsonl'), sessionLine('hi'));
    await new Promise((r) => setImmediate(r));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('picks up a brand-new project folder created after the watcher started', async () => {
    settings.set('gitSync.mode', 'git');
    watcher = new SessionsAutoSyncWatcher();
    await new Promise((r) => { const t = Date.now(); const w = () => (Date.now() - t > 400 ? r(undefined) : setImmediate(w)); w(); });
    const newDir = path.join(claudeHome, 'projects', '-home-u-newproj');
    await fs.mkdir(newDir);
    expect(await realWait(() => vi.getTimerCount() > 0, 5000)).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    await new Promise((r) => { const t = Date.now(); const w = () => (Date.now() - t > 400 ? r(undefined) : setImmediate(w)); w(); });
    await fs.writeFile(path.join(newDir, 'n1.jsonl'), sessionLine('from the new project'));

    const archiveName = machineArchiveFileName('claude-sessions.cmt', os.hostname());
    const archived = async () => {
      try {
        return openArchive(path.join(checkout, archiveName)).zip.getEntries().some((e) => e.entryName.endsWith('n1.jsonl'));
      } catch {
        return false;
      }
    };
    // A write that lands mid-sync schedules a follow-up debounced sync, so keep moving the
    // fake clock until the new project's session shows up in the pushed archive.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(await archived())) {
      if (vi.getTimerCount() > 0) {
        await vi.advanceTimersByTimeAsync(15_000);
      }
      await new Promise((r) => setImmediate(r));
    }
    expect(await archived()).toBe(true);
  });
});
