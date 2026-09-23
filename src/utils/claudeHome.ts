import * as os from 'node:os';
import * as path from 'node:path';

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
