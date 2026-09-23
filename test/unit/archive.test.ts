import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createArchive } from '../../src/archive/archiveWriter';
import {
  openArchive,
  extractProjectToStaging,
  extractSessionProjectToStaging,
  verifyChecksums,
} from '../../src/archive/archiveReader';
import { validateArchive } from '../../src/validation/validator';
import { ChecksumMismatchError, InvalidArchiveError } from '../../src/utils/errors';
import type { DiscoveredProject } from '../../src/models/project';
import type { DiscoveredSessionProject } from '../../src/models/session';

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'projects');

function makeProject(id: string, name: string): DiscoveredProject {
  return {
    id,
    name,
    sourcePath: path.join(FIXTURE_ROOT, name),
    claudePath: path.join(FIXTURE_ROOT, name, '.claude'),
    platform: 'darwin',
    username: 'alice',
    homeDirectory: '/Users/alice',
    hostname: 'alices-mac',
    claudeSizeBytes: 0,
    claudeFileCount: 0,
    lastModified: new Date().toISOString(),
  };
}

function makeSessionProject(id: string, folderPath: string): DiscoveredSessionProject {
  return {
    id,
    folderName: path.basename(folderPath),
    folderPath,
    sourcePath: '/home/alice/dev/my-api',
    sourcePathConfidence: 'from-session-cwd',
    sessions: [],
    hasMemoryDir: false,
    totalSizeBytes: 0,
    lastModified: new Date().toISOString(),
  };
}

describe('archive round trip', () => {
  let tempDir: string;
  let archiveFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmt-archive-test-'));
    archiveFile = path.join(tempDir, 'test.cmt');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates an archive and re-reads a matching manifest', async () => {
    const project = makeProject('path:project-a-test', 'project-a');
    const result = await createArchive({
      destinationFile: archiveFile,
      projects: [{ project }],
      includeHostname: false,
      compress: true,
    });

    expect(result.fileCount).toBeGreaterThan(0);

    const opened = openArchive(archiveFile);
    expect(opened.manifest.projects).toHaveLength(1);
    expect(opened.manifest.projects[0].id).toBe('path:project-a-test');
    expect(opened.manifest.source.hostname).toBe('redacted');
  });

  it('extracts a project into a staging directory with matching content', async () => {
    const project = makeProject('path:project-a-test', 'project-a');
    await createArchive({
      destinationFile: archiveFile,
      projects: [{ project }],
      includeHostname: false,
      compress: true,
    });

    const opened = openArchive(archiveFile);
    const stagingDir = path.join(tempDir, 'staged');
    const { fileCount } = await extractProjectToStaging(opened, 'path:project-a-test', stagingDir);
    expect(fileCount).toBeGreaterThan(0);

    const settings = await fs.readFile(path.join(stagingDir, 'settings.json'), 'utf8');
    const original = await fs.readFile(path.join(project.claudePath, 'settings.json'), 'utf8');
    expect(settings).toBe(original);
  });

  it('excludes files marked as excluded and omits them from checksums', async () => {
    const project = makeProject('path:project-a-test', 'project-a');
    await createArchive({
      destinationFile: archiveFile,
      projects: [{ project, excludedRelativePaths: new Set(['settings.json']) }],
      includeHostname: false,
      compress: true,
    });

    const opened = openArchive(archiveFile);
    expect(opened.manifest.projects[0].excludedFiles).toContain('settings.json');
    expect(Object.keys(opened.checksums)).not.toContain('projects/path:project-a-test/claude/settings.json');
  });

  it('validateArchive passes for a well-formed archive', async () => {
    const project = makeProject('path:project-a-test', 'project-a');
    await createArchive({
      destinationFile: archiveFile,
      projects: [{ project }],
      includeHostname: false,
      compress: true,
    });

    const validation = validateArchive(archiveFile);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('detects a corrupted archive entry via checksum verification', async () => {
    const project = makeProject('path:project-a-test', 'project-a');
    await createArchive({
      destinationFile: archiveFile,
      projects: [{ project }],
      includeHostname: false,
      compress: true,
    });

    const opened = openArchive(archiveFile);
    // Tamper with the stored checksum to simulate corruption.
    const key = Object.keys(opened.checksums)[0];
    opened.checksums[key] = '0'.repeat(64);

    const verification = verifyChecksums(opened, 'projects/path:project-a-test/claude/');
    expect(verification.ok).toBe(false);
    expect(verification.mismatched).toContain(key);
  });

  it('throws when extracting a project with a mismatched checksum', async () => {
    const project = makeProject('path:project-a-test', 'project-a');
    await createArchive({
      destinationFile: archiveFile,
      projects: [{ project }],
      includeHostname: false,
      compress: true,
    });

    const opened = openArchive(archiveFile);
    for (const key of Object.keys(opened.checksums)) {
      opened.checksums[key] = '0'.repeat(64);
    }

    await expect(
      extractProjectToStaging(opened, 'path:project-a-test', path.join(tempDir, 'staged-bad')),
    ).rejects.toThrow(ChecksumMismatchError);
  });

  it('rejects an archive missing manifest.json', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('nothing.txt', Buffer.from('x'));
    await new Promise<void>((resolve, reject) => {
      zip.writeZip(archiveFile, (err: Error | null) => (err ? reject(err) : resolve()));
    });

    expect(() => openArchive(archiveFile)).toThrow(InvalidArchiveError);
  });

  it('archives and extracts a Claude Code session project (jsonl + memory)', async () => {
    const sessionFolder = path.join(tempDir, 'source-session', '-home-alice-dev-my-api');
    await fs.mkdir(path.join(sessionFolder, 'memory'), { recursive: true });
    await fs.writeFile(
      path.join(sessionFolder, 'sess-1.jsonl'),
      '{"type":"user","cwd":"/home/alice/dev/my-api","message":{"role":"user","content":"hi"}}\n',
    );
    await fs.writeFile(path.join(sessionFolder, 'memory', 'MEMORY.md'), '# notes');

    const sessionProject = makeSessionProject('sess-project-1', sessionFolder);
    await createArchive({
      destinationFile: archiveFile,
      projects: [],
      sessionProjects: [{ project: sessionProject }],
      includeHostname: false,
      compress: true,
    });

    const opened = openArchive(archiveFile);
    expect(opened.manifest.sessionProjects).toHaveLength(1);
    expect(opened.manifest.sessionProjects[0].sourcePath).toBe('/home/alice/dev/my-api');

    const stagingDir = path.join(tempDir, 'session-staged');
    const { fileCount } = await extractSessionProjectToStaging(opened, 'sess-project-1', stagingDir);
    expect(fileCount).toBe(2);

    const sessionContent = await fs.readFile(path.join(stagingDir, 'sess-1.jsonl'), 'utf8');
    expect(sessionContent).toContain('/home/alice/dev/my-api');
    const memoryContent = await fs.readFile(path.join(stagingDir, 'memory', 'MEMORY.md'), 'utf8');
    expect(memoryContent).toBe('# notes');
  });
});
