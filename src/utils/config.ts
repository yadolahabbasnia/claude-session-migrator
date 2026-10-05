import * as vscode from 'vscode';

export function getScanMaxDepth(): number {
  return vscode.workspace.getConfiguration('claudeMigrator').get<number>('scanMaxDepth', 6);
}

export function getDebugLoggingEnabled(): boolean {
  return vscode.workspace.getConfiguration('claudeMigrator').get<boolean>('debugLogging', false);
}

export function getConfiguredScanDirectories(): string[] {
  return vscode.workspace.getConfiguration('claudeMigrator').get<string[]>('scanDirectories', []);
}

export function getGitSyncRepoUrl(): string {
  return vscode.workspace.getConfiguration('claudeMigrator').get<string>('gitSync.repoUrl', '');
}

export function getGitSyncLocalPath(): string {
  return vscode.workspace.getConfiguration('claudeMigrator').get<string>('gitSync.localPath', '');
}

export function getGitSyncBranch(): string {
  return vscode.workspace.getConfiguration('claudeMigrator').get<string>('gitSync.branch', 'main');
}

export function getGitSyncArchiveFileName(): string {
  return vscode.workspace
    .getConfiguration('claudeMigrator')
    .get<string>('gitSync.archiveFileName', 'claude-sessions.cmt');
}

export type GitSyncMode = 'local' | 'git';

/**
 * Which reference the sidebar and sync wizard currently treat as "the" sessions source:
 * `'local'` (default) is plain `~/.claude/projects/`, untouched by git sync. `'git'` means the
 * user has pointed sync at a repository and wants it treated as the reference going forward --
 * this never deletes or moves local session files, it only changes what the UI points at until
 * the user explicitly switches back with "Use Local Sessions Only".
 */
export function getGitSyncMode(): GitSyncMode {
  return vscode.workspace.getConfiguration('claudeMigrator').get<GitSyncMode>('gitSync.mode', 'local');
}

/** Persists a git-sync setting to user (global) settings, e.g. after the wizard prompts for it. */
export async function setGitSyncSetting(
  key: 'repoUrl' | 'localPath' | 'branch' | 'archiveFileName' | 'mode',
  value: string,
): Promise<void> {
  await vscode.workspace
    .getConfiguration('claudeMigrator')
    .update(`gitSync.${key}`, value, vscode.ConfigurationTarget.Global);
}
