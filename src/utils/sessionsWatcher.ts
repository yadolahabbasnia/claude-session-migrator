import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getClaudeHomeDir, getSessionsRootDir } from './claudeHome';
import {
  getGitSyncArchiveFileName,
  getGitSyncAutoSyncEnabled,
  getGitSyncBranch,
  getGitSyncLocalPath,
  getGitSyncMode,
  getGitSyncRepoUrl,
} from './config';
import {
  commitAndPush,
  discardFileChanges,
  ensureRepoAtPath,
  getCommittedFileSize,
  isGitInstalled,
  isSuspiciousShrink,
  machineArchiveFileName,
  pull,
} from './gitSync';
import { runHeadlessSessionsExport } from '../archive/autoExport';
import { getMachineInfo } from './platform';
import { logger } from './logging';
import { syncRuntime } from './syncRuntime';

const DEBOUNCE_MS = 15_000;

/**
 * Watches `<claudeHome>/projects` (where Claude Code writes session `.jsonl` files) and, while
 * `gitSync.mode` is `'git'` and `gitSync.autoSync` is enabled, auto-commits and pushes a short,
 * debounced while after things settle -- so sessions end up on the configured repo without the
 * user having to run "Sync Sessions via Git" by hand every time. It only ever writes into the
 * dedicated sync-repo checkout; it never touches `~/.claude/projects` itself.
 */
export class SessionsAutoSyncWatcher implements vscode.Disposable {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly configListener: vscode.Disposable;
  private debounceTimer: NodeJS.Timeout | undefined;
  private syncing = false;
  private pendingResync = false;
  private disposed = false;

  constructor() {
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeMigrator.gitSync')) {
        this.restart();
      }
    });
    this.restart();
  }

  dispose(): void {
    this.disposed = true;
    this.configListener.dispose();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.closeAllWatchers();
  }

  private closeAllWatchers(): void {
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        // already closed
      }
    }
    this.watchers.clear();
  }

  private restart(): void {
    this.closeAllWatchers();
    if (this.disposed || getGitSyncMode() !== 'git' || !getGitSyncAutoSyncEnabled()) {
      syncRuntime.update({ watcher: 'off', nextSyncAt: undefined });
      return;
    }
    syncRuntime.update({ watcher: 'idle', nextSyncAt: undefined });
    const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());
    this.watchRecursive(sessionsRoot).catch((err) => {
      logger.warn('Could not start Claude Code sessions auto-sync watcher', { error: String(err) });
    });
  }

  /** Watches `dir` if not already watched, then (always) scans it for subdirectories that
   * aren't watched yet -- so a brand-new session project folder gets picked up on the next
   * change event in its parent, without re-creating watchers that already exist. */
  private async watchRecursive(dir: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (!this.watchers.has(dir)) {
      try {
        const watcher = fs.watch(dir, { persistent: false }, () => this.onChange(dir));
        this.watchers.set(dir, watcher);
      } catch {
        return; // dir doesn't exist yet, or isn't readable -- skip quietly
      }
    }

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sub = path.join(dir, entry.name);
        if (!this.watchers.has(sub)) {
          await this.watchRecursive(sub);
        }
      }
    }
  }

  private onChange(dir: string): void {
    this.watchRecursive(dir).catch(() => {
      // best-effort: a missed new subdirectory just means it's picked up on its own first change
    });
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => void this.runSync(), DEBOUNCE_MS);
    syncRuntime.update({ watcher: 'pending', nextSyncAt: new Date(Date.now() + DEBOUNCE_MS).toISOString() });
  }

  private async runSync(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.syncing) {
      this.pendingResync = true;
      return;
    }
    if (getGitSyncMode() !== 'git' || !getGitSyncAutoSyncEnabled()) {
      return;
    }
    const repoUrl = getGitSyncRepoUrl();
    const localPath = getGitSyncLocalPath();
    if (!repoUrl || !localPath) {
      return;
    }

    this.syncing = true;
    syncRuntime.update({ watcher: 'syncing', nextSyncAt: undefined });
    let outcome: { ok: boolean; pushed: boolean; message?: string } | undefined;
    try {
      if (!(await isGitInstalled())) {
        outcome = { ok: false, pushed: false, message: 'git was not found on PATH' };
        return;
      }
      const branch = getGitSyncBranch();
      await ensureRepoAtPath(localPath, repoUrl, branch);
      await pull(localPath, branch);

      const machine = getMachineInfo();
      const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());
      const archiveFileName = machineArchiveFileName(getGitSyncArchiveFileName(), machine.hostname);
      const archivePath = path.join(localPath, archiveFileName);
      const previousSize = await getCommittedFileSize(localPath, archiveFileName);
      const result = await runHeadlessSessionsExport(sessionsRoot, archivePath);
      if (!result) {
        outcome = { ok: true, pushed: false, message: 'No sessions to sync yet' };
        return;
      }
      if (isSuspiciousShrink(previousSize, result.archiveSizeBytes)) {
        logger.warn('Auto-sync skipped: new archive is less than half the size of the last pushed one', {
          previousSize,
          newSize: result.archiveSizeBytes,
        });
        await discardFileChanges(localPath, archiveFileName);
        outcome = { ok: false, pushed: false, message: 'Skipped: the new archive was less than half the size of the last push' };
        return;
      }

      const pushed = await commitAndPush(
        localPath,
        branch,
        `Auto-sync Claude sessions from ${machine.hostname} (${new Date().toISOString()})`,
      );
      outcome = { ok: true, pushed };
      if (pushed) {
        logger.info('Auto-synced Claude Code sessions to git', {
          repoUrl,
          projects: result.projectCount,
          files: result.fileCount,
          redactedSecretFiles: result.redactedSecretFiles,
        });
      }
    } catch (err) {
      // Auto-sync is best-effort and silent by design -- a transient failure (e.g. a push that
      // needs a manual merge) just gets retried on the next change instead of interrupting the
      // user with an error dialog for something that happened in the background.
      logger.warn('Sessions auto-sync failed; will retry on the next change', { error: String(err) });
      outcome = { ok: false, pushed: false, message: (err as Error).message };
    } finally {
      this.syncing = false;
      syncRuntime.update({
        watcher: 'idle',
        ...(outcome ? { lastAuto: { at: new Date().toISOString(), ...outcome } } : {}),
      });
      if (this.pendingResync) {
        this.pendingResync = false;
        this.debounceTimer = setTimeout(() => void this.runSync(), DEBOUNCE_MS);
        syncRuntime.update({ watcher: 'pending', nextSyncAt: new Date(Date.now() + DEBOUNCE_MS).toISOString() });
      }
    }
  }
}
