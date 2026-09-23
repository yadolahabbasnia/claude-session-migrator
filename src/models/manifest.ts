/** On-disk manifest format stored inside a .cmt archive. */

export const MANIFEST_FORMAT_VERSION = 1;

export interface ManifestSource {
  platform: NodeJS.Platform;
  architecture: string;
  hostname: string;
  homeDirectory: string;
}

export interface ManifestGit {
  repoRoot: string;
  remoteUrls: string[];
  branch?: string;
}

export interface ManifestProjectEntry {
  id: string;
  name: string;
  sourcePath: string;
  claudePath: string;
  git?: ManifestGit;
  fileCount: number;
  sizeBytes: number;
  /** Files (relative to the project's claude/ folder in the archive) that were excluded, e.g. due to secrets. */
  excludedFiles: string[];
}

export interface ManifestSessionEntry {
  id: string;
  /** The opaque, encoded directory name this project's sessions lived under on the source
   * machine (`<CLAUDE_CONFIG_DIR>/projects/<folderName>`). Informational only -- never decoded. */
  folderName: string;
  /** Best-known true source path, read from the most recent session's recorded `cwd`. */
  sourcePath?: string;
  git?: ManifestGit;
  sessionCount: number;
  sizeBytes: number;
  hasMemoryDir: boolean;
  excludedFiles: string[];
}

export interface Manifest {
  formatVersion: number;
  toolVersion: string;
  createdAt: string;
  source: ManifestSource;
  projects: ManifestProjectEntry[];
  /** Claude Code session-project entries (added in the same format version; absent/empty on
   * archives created before this feature existed). */
  sessionProjects: ManifestSessionEntry[];
}

export function isManifest(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Manifest>;
  return (
    typeof candidate.formatVersion === 'number' &&
    typeof candidate.toolVersion === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.source === 'object' &&
    candidate.source !== null &&
    Array.isArray(candidate.projects)
  );
}
