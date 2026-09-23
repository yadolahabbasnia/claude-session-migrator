import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runHealthCheck } from '../../src/validation/healthCheck';
import type { PathContext } from '../../src/migration/pathResolver';

describe('runHealthCheck', () => {
  let tempDir: string;
  let claudeDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-health-test-'));
    claudeDir = path.join(tempDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('fails when the .claude directory is missing', async () => {
    await fs.rm(claudeDir, { recursive: true, force: true });
    const report = await runHealthCheck({ destinationContentDir: claudeDir, expectedFileCount: 0 });
    expect(report.failed).toBeGreaterThan(0);
  });

  it('passes when files exist and JSON is valid', async () => {
    await fs.writeFile(path.join(claudeDir, 'settings.json'), '{"ok":true}');
    const report = await runHealthCheck({ destinationContentDir: claudeDir, expectedFileCount: 1 });
    expect(report.failed).toBe(0);
  });

  it('fails when a JSON file does not parse', async () => {
    await fs.writeFile(path.join(claudeDir, 'settings.json'), '{not valid json');
    const report = await runHealthCheck({ destinationContentDir: claudeDir, expectedFileCount: 1 });
    const jsonItem = report.items.find((i) => i.id === 'json-valid');
    expect(jsonItem?.status).toBe('fail');
  });

  it('validates .jsonl files line by line', async () => {
    await fs.writeFile(
      path.join(claudeDir, 'session.jsonl'),
      '{"a":1}\n{"b":2}\n',
    );
    const report = await runHealthCheck({ destinationContentDir: claudeDir, expectedFileCount: 1 });
    const jsonItem = report.items.find((i) => i.id === 'json-valid');
    expect(jsonItem?.status).toBe('pass');
  });

  it('fails when a .jsonl file has a malformed line', async () => {
    await fs.writeFile(
      path.join(claudeDir, 'session.jsonl'),
      '{"a":1}\nnot json at all\n{"b":2}\n',
    );
    const report = await runHealthCheck({ destinationContentDir: claudeDir, expectedFileCount: 1 });
    const jsonItem = report.items.find((i) => i.id === 'json-valid');
    expect(jsonItem?.status).toBe('fail');
  });

  it('warns when fewer files exist than expected', async () => {
    const report = await runHealthCheck({ destinationContentDir: claudeDir, expectedFileCount: 5 });
    const fileCountItem = report.items.find((i) => i.id === 'file-count');
    expect(fileCountItem?.status).toBe('warn');
  });

  it('warns when a literal source-machine path remains in a migrated file', async () => {
    const sourceContext: PathContext = {
      projectRoot: '/Users/alice/dev/my-api',
      homeDir: '/Users/alice',
      workspaceRoot: '/Users/alice/dev/my-api',
      style: 'posix',
    };
    await fs.writeFile(path.join(claudeDir, 'leftover.txt'), 'still points at /Users/alice/dev/my-api/data');
    const report = await runHealthCheck({
      destinationContentDir: claudeDir,
      expectedFileCount: 1,
      sourceContext,
    });
    const staleItem = report.items.find((i) => i.id === 'no-stale-paths');
    expect(staleItem?.status).toBe('warn');
  });

  it('warns about unresolved references passed in from the migration preview', async () => {
    await fs.writeFile(path.join(claudeDir, 'settings.json'), '{}');
    const report = await runHealthCheck({
      destinationContentDir: claudeDir,
      expectedFileCount: 1,
      unresolvedReferences: [
        {
          projectId: 'p1',
          file: 'settings.json',
          line: 1,
          originalPath: '/opt/tool',
          kind: 'absolute-unclassified',
          resolution: 'unresolved',
        },
      ],
    });
    const item = report.items.find((i) => i.id === 'unresolved-references');
    expect(item?.status).toBe('warn');
  });
});
