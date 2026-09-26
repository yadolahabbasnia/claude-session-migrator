import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getImportLogPath,
  readImportLog,
  appendImportLogEntries,
  removeImportLogEntries,
} from '../../src/utils/importLog';
import type { ImportLogEntry } from '../../src/models/importLog';

function makeEntry(overrides: Partial<ImportLogEntry> = {}): ImportLogEntry {
  return {
    id: 'entry-1',
    kind: 'session',
    label: 'my-api',
    destinationContentDir: '/home/alice/.claude/projects/-home-alice-my-api',
    existedBefore: false,
    importedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('importLog', () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-log-test-'));
    logPath = getImportLogPath(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns an empty array when no log file exists yet', async () => {
    expect(await readImportLog(logPath)).toEqual([]);
  });

  it('appends entries and reads them back', async () => {
    await appendImportLogEntries([makeEntry()], logPath);
    await appendImportLogEntries([makeEntry({ id: 'entry-2', label: 'other' })], logPath);

    const entries = await readImportLog(logPath);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual(['entry-1', 'entry-2']);
  });

  it('is a no-op when appending zero entries', async () => {
    await appendImportLogEntries([], logPath);
    expect(await readImportLog(logPath)).toEqual([]);
  });

  it('removes entries by id, leaving the rest untouched', async () => {
    await appendImportLogEntries([makeEntry({ id: 'entry-1' }), makeEntry({ id: 'entry-2' })], logPath);
    await removeImportLogEntries(['entry-1'], logPath);

    const entries = await readImportLog(logPath);
    expect(entries.map((e) => e.id)).toEqual(['entry-2']);
  });

  it('treats a corrupt log file as empty instead of throwing', async () => {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, 'not json', 'utf8');
    expect(await readImportLog(logPath)).toEqual([]);
  });
});
