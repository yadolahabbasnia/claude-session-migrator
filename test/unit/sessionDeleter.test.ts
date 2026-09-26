import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  resolveDeletionTargets,
  deleteSessionTargets,
  permanentRemover,
  type Remover,
} from '../../src/migration/sessionDeleter';
import { UnsafeDeletionTargetError } from '../../src/utils/errors';

describe('sessionDeleter', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-deleter-test-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function makeProject(folderName: string, fileNames: string[]): Promise<string> {
    const folder = path.join(root, folderName);
    await fs.mkdir(folder, { recursive: true });
    for (const name of fileNames) {
      await fs.writeFile(path.join(folder, name), '{"type":"user"}\n', 'utf8');
    }
    return folder;
  }

  describe('resolveDeletionTargets', () => {
    it('resolves a whole project to one recursive target', () => {
      const targets = resolveDeletionTargets(root, { kind: 'project', folderName: '-home-me-api' });
      expect(targets).toEqual([
        {
          absolutePath: path.join(root, '-home-me-api'),
          recursive: true,
          kind: 'project',
          label: '-home-me-api',
        },
      ]);
    });

    it('resolves each session file to a non-recursive target under the project folder', () => {
      const targets = resolveDeletionTargets(root, {
        kind: 'sessions',
        folderName: '-home-me-api',
        fileNames: ['a.jsonl', 'b.jsonl'],
      });
      expect(targets.map((t) => t.absolutePath)).toEqual([
        path.join(root, '-home-me-api', 'a.jsonl'),
        path.join(root, '-home-me-api', 'b.jsonl'),
      ]);
      expect(targets.every((t) => t.recursive === false)).toBe(true);
    });

    it('returns nothing when no session files were named', () => {
      expect(
        resolveDeletionTargets(root, { kind: 'sessions', folderName: 'p', fileNames: [] }),
      ).toEqual([]);
    });

    it.each([
      ['..', 'parent traversal'],
      ['.', 'current directory'],
      ['', 'empty name'],
      ['../../etc', 'escaping path'],
      ['sub/nested', 'nested path'],
    ])('refuses folder name %j (%s)', (folderName) => {
      expect(() => resolveDeletionTargets(root, { kind: 'project', folderName })).toThrow(
        UnsafeDeletionTargetError,
      );
    });

    it('refuses an absolute folder name even when it points inside the root', () => {
      expect(() =>
        resolveDeletionTargets(root, { kind: 'project', folderName: path.join(root, 'p') }),
      ).toThrow(UnsafeDeletionTargetError);
    });

    it.each([
      ['../outside.jsonl', 'traversal'],
      ['sub/a.jsonl', 'nested path'],
      ['notes.txt', 'wrong extension'],
      ['a.jsonl.bak', 'wrong extension'],
      ['', 'empty name'],
    ])('refuses session file name %j (%s)', (fileName) => {
      expect(() =>
        resolveDeletionTargets(root, { kind: 'sessions', folderName: 'p', fileNames: [fileName] }),
      ).toThrow(UnsafeDeletionTargetError);
    });

    it('refuses the whole batch if any one file name is unsafe', () => {
      expect(() =>
        resolveDeletionTargets(root, {
          kind: 'sessions',
          folderName: 'p',
          fileNames: ['ok.jsonl', '../escape.jsonl'],
        }),
      ).toThrow(UnsafeDeletionTargetError);
    });
  });

  describe('deleteSessionTargets', () => {
    it('deletes selected session files and leaves the others', async () => {
      const folder = await makeProject('-home-me-api', ['a.jsonl', 'b.jsonl', 'c.jsonl']);
      const targets = resolveDeletionTargets(root, {
        kind: 'sessions',
        folderName: '-home-me-api',
        fileNames: ['a.jsonl', 'c.jsonl'],
      });

      const outcome = await deleteSessionTargets(targets, { remove: permanentRemover });

      expect(outcome.failures).toEqual([]);
      expect(outcome.deleted).toHaveLength(2);
      expect(await fs.readdir(folder)).toEqual(['b.jsonl']);
    });

    it('deletes a whole project folder recursively, memory directory included', async () => {
      const folder = await makeProject('-home-me-api', ['a.jsonl']);
      await fs.mkdir(path.join(folder, 'memory'), { recursive: true });
      await fs.writeFile(path.join(folder, 'memory', 'MEMORY.md'), '# notes\n', 'utf8');

      const targets = resolveDeletionTargets(root, { kind: 'project', folderName: '-home-me-api' });
      const outcome = await deleteSessionTargets(targets, { remove: permanentRemover });

      expect(outcome.failures).toEqual([]);
      await expect(fs.access(folder)).rejects.toThrow();
    });

    it('prunes the project folder once its last session is gone', async () => {
      const folder = await makeProject('-home-me-api', ['only.jsonl']);
      const targets = resolveDeletionTargets(root, {
        kind: 'sessions',
        folderName: '-home-me-api',
        fileNames: ['only.jsonl'],
      });

      const outcome = await deleteSessionTargets(targets, {
        remove: permanentRemover,
        pruneEmptyFolders: true,
      });

      expect(outcome.prunedFolders).toEqual([folder]);
      await expect(fs.access(folder)).rejects.toThrow();
    });

    it('keeps a folder that still holds a memory directory after its sessions are deleted', async () => {
      const folder = await makeProject('-home-me-api', ['only.jsonl']);
      await fs.mkdir(path.join(folder, 'memory'), { recursive: true });

      const targets = resolveDeletionTargets(root, {
        kind: 'sessions',
        folderName: '-home-me-api',
        fileNames: ['only.jsonl'],
      });
      const outcome = await deleteSessionTargets(targets, {
        remove: permanentRemover,
        pruneEmptyFolders: true,
      });

      expect(outcome.prunedFolders).toEqual([]);
      expect(await fs.readdir(folder)).toEqual(['memory']);
    });

    it('does not prune when pruneEmptyFolders is off', async () => {
      const folder = await makeProject('-home-me-api', ['only.jsonl']);
      const targets = resolveDeletionTargets(root, {
        kind: 'sessions',
        folderName: '-home-me-api',
        fileNames: ['only.jsonl'],
      });

      const outcome = await deleteSessionTargets(targets, { remove: permanentRemover });

      expect(outcome.prunedFolders).toEqual([]);
      expect(await fs.readdir(folder)).toEqual([]);
    });

    it('reports a failed target but still deletes the rest', async () => {
      await makeProject('-home-me-api', ['a.jsonl', 'b.jsonl']);
      const targets = resolveDeletionTargets(root, {
        kind: 'sessions',
        folderName: '-home-me-api',
        fileNames: ['a.jsonl', 'b.jsonl'],
      });

      const failing: Remover = async (absolutePath, options) => {
        if (absolutePath.endsWith('a.jsonl')) {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        }
        await permanentRemover(absolutePath, options);
      };

      const outcome = await deleteSessionTargets(targets, { remove: failing });

      expect(outcome.deleted.map((t) => t.label)).toEqual(['b.jsonl']);
      expect(outcome.failures).toHaveLength(1);
      expect(outcome.failures[0].target.label).toBe('a.jsonl');
      expect(outcome.failures[0].message).toContain('Permission denied');
    });

    it('surfaces a missing file as a failure rather than throwing', async () => {
      await makeProject('-home-me-api', []);
      const targets = resolveDeletionTargets(root, {
        kind: 'sessions',
        folderName: '-home-me-api',
        fileNames: ['ghost.jsonl'],
      });

      const outcome = await deleteSessionTargets(targets, { remove: permanentRemover });

      expect(outcome.deleted).toEqual([]);
      expect(outcome.failures).toHaveLength(1);
      expect(outcome.failures[0].message).toContain('Path not found');
    });
  });
});
