/** A detected Claude project on the local filesystem. */
export interface GitInfo {
  repoRoot: string;
  remoteUrls: string[];
  branch?: string;
}

export interface DiscoveredProject {
  /** Stable identity, preferring git remote/repo identity over the absolute path. */
  id: string;
  name: string;
  sourcePath: string;
  claudePath: string;
  /** Path relative to the workspace root that was scanned, when available. */
  relativePath?: string;
  platform: NodeJS.Platform;
  username: string;
  homeDirectory: string;
  hostname: string;
  git?: GitInfo;
  claudeSizeBytes: number;
  claudeFileCount: number;
  lastModified: string;
}
