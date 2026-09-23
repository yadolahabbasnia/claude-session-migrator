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
