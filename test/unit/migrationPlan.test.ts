import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildMigrationPreview } from '../../src/migration/migrationPlan';
import type { PathContext } from '../../src/migration/pathResolver';

const source: PathContext = {
  projectRoot: '/Users/alice/dev/my-api',
  homeDir: '/Users/alice',
  workspaceRoot: '/Users/alice/dev/my-api',
  style: 'posix',
};

describe('buildMigrationPreview', () => {
  let tempDir: string;
  let stagedContentDir: string;
  let destinationPath: string;
  let dest: PathContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-preview-test-'));
    stagedContentDir = path.join(tempDir, 'staged');
    destinationPath = path.join(tempDir, 'dest-project');
    await fs.mkdir(stagedContentDir, { recursive: true });
    await fs.mkdir(destinationPath, { recursive: true });
    dest = {
      projectRoot: destinationPath,
      homeDir: os.homedir(),
      workspaceRoot: destinationPath,
      style: process.platform === 'win32' ? 'win32' : 'posix',
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reports every staged file as new when the destination has no .claude yet', async () => {
    await fs.writeFile(path.join(stagedContentDir, 'settings.json'), '{}');
    await fs.writeFile(path.join(stagedContentDir, 'notes.txt'), 'hello');

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    expect(preview.destinationExists).toBe(false);
    expect(preview.totalFiles).toBe(2);
    expect(preview.newFiles).toBe(2);
    expect(preview.modifiedFiles).toBe(0);
    expect(preview.existingFilesPreserved).toBe(0);
  });

  it('classifies files as preserved (identical) or modified (different) against an existing .claude', async () => {
    const destClaudeDir = path.join(destinationPath, '.claude');
    await fs.mkdir(destClaudeDir, { recursive: true });
    await fs.writeFile(path.join(destClaudeDir, 'same.txt'), 'unchanged content');
    await fs.writeFile(path.join(destClaudeDir, 'different.txt'), 'old content');

    await fs.writeFile(path.join(stagedContentDir, 'same.txt'), 'unchanged content');
    await fs.writeFile(path.join(stagedContentDir, 'different.txt'), 'new content');

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    expect(preview.destinationExists).toBe(true);
    expect(preview.existingFilesPreserved).toBe(1);
    expect(preview.modifiedFiles).toBe(1);
    expect(preview.newFiles).toBe(0);
  });

  it('counts path replacements and surfaces unresolved references', async () => {
    await fs.writeFile(
      path.join(stagedContentDir, 'settings.json'),
      JSON.stringify({ cwd: '/Users/alice/dev/my-api/data', unrelated: '/opt/tool/bin' }),
    );

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    expect(preview.pathReplacements).toBe(1);
    expect(preview.unresolvedReferences).toHaveLength(1);
    expect(preview.unresolvedReferences[0].originalPath).toBe('/opt/tool/bin');
  });

  it('preserves binary files without attempting path replacement', async () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    await fs.writeFile(path.join(stagedContentDir, 'data.bin'), binary);

    const preview = await buildMigrationPreview({
      projectId: 'p1',
      projectName: 'my-api',
      stagedContentDir,
      destinationPath,
      destinationContentDir: path.join(destinationPath, '.claude'),
      sourceContext: source,
      destContext: dest,
    });

    expect(preview.files[0].isBinary).toBe(true);
    expect(preview.files[0].pathReplacements).toBe(0);
  });
});
