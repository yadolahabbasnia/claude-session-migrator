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

/** Persists a git-sync setting to user (global) settings, e.g. after the wizard prompts for it. */
export async function setGitSyncSetting(
  key: 'repoUrl' | 'localPath' | 'branch' | 'archiveFileName',
  value: string,
): Promise<void> {
  await vscode.workspace
    .getConfiguration('claudeMigrator')
    .update(`gitSync.${key}`, value, vscode.ConfigurationTarget.Global);
}
