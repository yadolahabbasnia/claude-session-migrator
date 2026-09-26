/** Types describing path portability and the migration plan/preview. */

/** Portable tokens that stand in for machine-specific absolute path prefixes. */
export type PortableToken = '$PROJECT_ROOT' | '$HOME' | '$WORKSPACE_ROOT';

export interface PathReference {
  /** File the reference was found in, relative to the .claude directory. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The raw matched machine-specific path. */
  originalPath: string;
  /** The portable token representation, when one could be derived. */
  portablePath?: PortableToken | string;
  kind: 'home' | 'project-root' | 'workspace-root' | 'absolute-unclassified';
}

export interface DestinationMapping {
  projectId: string;
  /** Resolved absolute destination path for the project root, if known. */
  destinationPath?: string;
  /** How the destination was determined. */
  matchedBy?:
    | 'existing-folder-name'
    | 'git-remote'
    | 'project-name'
    | 'existing-claude'
    | 'manual';
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface UnresolvedReference extends PathReference {
  projectId: string;
  resolution: 'replaced' | 'ignored' | 'unresolved';
}

export interface FileMigrationAction {
  /** Path relative to the project's .claude directory. */
  relativePath: string;
  action: 'create' | 'modify' | 'preserve' | 'skip';
  isBinary: boolean;
  pathReplacements: number;
}

export interface ProjectMigrationPreview {
  projectId: string;
  projectName: string;
  /** The destination project/session-project root the user picked or matched. */
  destinationPath: string;
  /** The actual directory the migrated files are read from / written to (e.g.
   * `<destinationPath>/.claude` for project config, or `<sessionsRoot>/<encoded>` for sessions). */
  destinationContentDir: string;
  destinationExists: boolean;
  files: FileMigrationAction[];
  totalFiles: number;
  newFiles: number;
  modifiedFiles: number;
  existingFilesPreserved: number;
  pathReplacements: number;
  warnings: string[];
  unresolvedReferences: UnresolvedReference[];
}

export type ExistingDataStrategy = 'backup-and-replace' | 'merge' | 'skip' | 'cancel';
