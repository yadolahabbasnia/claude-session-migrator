import type { GitInfo } from './project';

export interface SessionFileSummary {
  /** File name only, e.g. `<uuid>.jsonl`. */
  fileName: string;
  sizeBytes: number;
  lastModified: string;
  sessionId?: string;
  slug?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  /** Count of user/assistant turns (not every raw jsonl line -- some are bookkeeping events). */
  messageCount: number;
  /** Short, truncated preview of the first user message, for display only. */
  firstUserMessagePreview?: string;
}

export interface DiscoveredSessionProject {
  /** Stable identity, preferring the project's git remote (from its live source path, when it
   * still exists on this machine) with a source-path-hash fallback -- same scheme as
   * DiscoveredProject in models/project.ts. */
  id: string;
  /** The raw, opaque directory name under `<claudeHome>/projects/`. Never decoded. */
  folderName: string;
  /** Absolute path to `<claudeHome>/projects/<folderName>`. */
  folderPath: string;
  /** Best-known true source path for this project, read from the `cwd` field recorded inside
   * its most recently modified session file. Undefined if no session recorded one. */
  sourcePath?: string;
  /** How `sourcePath` was determined; sessions never rely on decoding `folderName`. */
  sourcePathConfidence: 'from-session-cwd' | 'unknown';
  git?: GitInfo;
  sessions: SessionFileSummary[];
  hasMemoryDir: boolean;
  totalSizeBytes: number;
  lastModified: string;
}
