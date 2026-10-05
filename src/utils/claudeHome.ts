import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { isDirectory } from './filesystem';

/**
 * Resolves Claude Code's own config directory the same way the Claude Code CLI/extension does:
 * `CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`. Sessions for every project Claude Code has
 * ever been used in live under `<this>/projects/`.
 */
export function getClaudeHomeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function getSessionsRootDir(claudeHomeDir: string = getClaudeHomeDir()): string {
  return path.join(claudeHomeDir, 'projects');
}

export interface ClaudeProfile {
  /** A Claude Code config dir (what `getClaudeHomeDir()` would return for it), e.g. `~/.claude`. */
  homeDir: string;
  /** Whether this is the one the current `CLAUDE_CONFIG_DIR`/default would resolve to. */
  isActive: boolean;
}

/**
 * Looks for more than one Claude Code config dir on this machine -- e.g. `~/.claude` plus
 * `~/.claude-work` for a second account -- so callers that are about to sync sessions can ask
 * the user which one they mean instead of silently assuming the currently active one.
 */
export async function detectClaudeProfiles(): Promise<ClaudeProfile[]> {
  const active = getClaudeHomeDir();
  const home = os.homedir();
  const candidates = new Set<string>([active]);

  try {
    const entries = await fs.readdir(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\.claude($|[-_].+)/.test(entry.name)) {
        continue;
      }
      candidates.add(path.join(home, entry.name));
    }
  } catch {
    // Home directory unreadable -- fall back to just the active candidate below.
  }

  const profiles: ClaudeProfile[] = [];
  for (const dir of candidates) {
    if (await isDirectory(path.join(dir, 'projects'))) {
      profiles.push({ homeDir: dir, isActive: dir === active });
    }
  }
  return profiles;
}
