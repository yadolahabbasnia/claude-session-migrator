import * as os from 'node:os';
import * as path from 'node:path';

export interface MachineInfo {
  platform: NodeJS.Platform;
  architecture: string;
  hostname: string;
  homeDirectory: string;
  username: string;
}

export function getMachineInfo(): MachineInfo {
  return {
    platform: process.platform,
    architecture: process.arch,
    hostname: safeHostname(),
    homeDirectory: os.homedir(),
    username: safeUsername(),
  };
}

function safeHostname(): string {
  try {
    return os.hostname();
  } catch {
    return 'unknown-host';
  }
}

function safeUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown-user';
  }
}

export function isWindowsPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

/**
 * Suggested (never auto-scanned) common developer directories for the current OS, offered as
 * quick picks when the user explicitly asks to scan beyond the current workspace.
 */
export function getSuggestedScanDirectories(homeDir: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return [homeDir, path.join(homeDir, 'source', 'repos'), path.join(homeDir, 'Projects')];
  }
  return [
    path.join(homeDir, 'Projects'),
    path.join(homeDir, 'Developer'),
    path.join(homeDir, 'Development'),
    path.join(homeDir, 'Code'),
    path.join(homeDir, 'Work'),
  ];
}
