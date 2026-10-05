import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectClaudeProfiles, getClaudeHomeDir } from '../../src/utils/claudeHome';

describe('detectClaudeProfiles', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let originalConfigDir: string | undefined;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-home-test-'));
    originalHome = process.env.HOME;
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = tempHome;
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('reports a single profile when only the active home dir has sessions', async () => {
    await fs.mkdir(path.join(tempHome, '.claude', 'projects'), { recursive: true });

    const profiles = await detectClaudeProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toEqual({ homeDir: getClaudeHomeDir(), isActive: true });
  });

  it('detects a second account/profile sitting next to the active one', async () => {
    await fs.mkdir(path.join(tempHome, '.claude', 'projects'), { recursive: true });
    await fs.mkdir(path.join(tempHome, '.claude-work', 'projects'), { recursive: true });

    const profiles = await detectClaudeProfiles();

    expect(profiles).toHaveLength(2);
    const byDir = new Map(profiles.map((p) => [p.homeDir, p]));
    expect(byDir.get(path.join(tempHome, '.claude'))?.isActive).toBe(true);
    expect(byDir.get(path.join(tempHome, '.claude-work'))?.isActive).toBe(false);
  });

  it('ignores a .claude-like dir with no projects subfolder', async () => {
    await fs.mkdir(path.join(tempHome, '.claude', 'projects'), { recursive: true });
    await fs.mkdir(path.join(tempHome, '.claude-empty'), { recursive: true });

    const profiles = await detectClaudeProfiles();

    expect(profiles).toHaveLength(1);
  });
});
