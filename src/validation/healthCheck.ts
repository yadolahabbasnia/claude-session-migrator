import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathExists, walkFiles, looksBinary } from '../utils/filesystem';
import type { PathContext } from '../migration/pathResolver';
import type { UnresolvedReference } from '../models/migration';

export type HealthStatus = 'pass' | 'warn' | 'fail';

export interface HealthCheckItem {
  id: string;
  status: HealthStatus;
  message: string;
}

export interface HealthCheckReport {
  items: HealthCheckItem[];
  passed: number;
  warnings: number;
  failed: number;
}

export interface HealthCheckOptions {
  destinationContentDir: string;
  expectedFileCount: number;
  /** Omit for a standalone validation (not part of an import) -- the stale-path check is
   * skipped when there's no source machine to compare against. */
  sourceContext?: PathContext;
  unresolvedReferences?: UnresolvedReference[];
}

export async function runHealthCheck(options: HealthCheckOptions): Promise<HealthCheckReport> {
  const items: HealthCheckItem[] = [];

  const exists = await pathExists(options.destinationContentDir);
  items.push(
    exists
      ? { id: 'content-dir-exists', status: 'pass', message: 'Destination content directory exists.' }
      : { id: 'content-dir-exists', status: 'fail', message: 'Destination content directory is missing.' },
  );

  if (exists) {
    let actualFileCount = 0;
    let invalidJsonCount = 0;
    let staleReferenceCount = 0;

    for await (const file of walkFiles(options.destinationContentDir)) {
      actualFileCount += 1;
      const buffer = await fs.readFile(file.absolutePath);
      if (looksBinary(buffer)) {
        continue;
      }
      const text = buffer.toString('utf8');

      const ext = path.extname(file.relativePath).toLowerCase();
      if (ext === '.json') {
        try {
          JSON.parse(text);
        } catch {
          invalidJsonCount += 1;
        }
      } else if (ext === '.jsonl') {
        for (const jsonLine of text.split('\n')) {
          if (!jsonLine.trim()) {
            continue;
          }
          try {
            JSON.parse(jsonLine);
          } catch {
            invalidJsonCount += 1;
            break; // one bad line is enough to flag the file; avoid double-counting per line
          }
        }
      }

      if (options.sourceContext && containsStaleSourcePath(text, options.sourceContext)) {
        staleReferenceCount += 1;
      }
    }

    items.push(
      actualFileCount >= options.expectedFileCount
        ? {
            id: 'file-count',
            status: 'pass',
            message: `${actualFileCount} file(s) present at the destination (expected at least ${options.expectedFileCount}).`,
          }
        : {
            id: 'file-count',
            status: 'warn',
            message: `Only ${actualFileCount} of ${options.expectedFileCount} expected file(s) are present.`,
          },
    );

    items.push(
      invalidJsonCount === 0
        ? { id: 'json-valid', status: 'pass', message: 'All JSON files parse successfully.' }
        : { id: 'json-valid', status: 'fail', message: `${invalidJsonCount} JSON file(s) failed to parse.` },
    );

    if (options.sourceContext) {
      items.push(
        staleReferenceCount === 0
          ? {
              id: 'no-stale-paths',
              status: 'pass',
              message: 'No literal references to the source machine path remain.',
            }
          : {
              id: 'no-stale-paths',
              status: 'warn',
              message: `${staleReferenceCount} file(s) still contain a literal reference to the source machine's path.`,
            },
      );
    }
  }

  const unresolvedReferences = options.unresolvedReferences ?? [];
  items.push(
    unresolvedReferences.length === 0
      ? { id: 'unresolved-references', status: 'pass', message: 'All path references were migrated.' }
      : {
          id: 'unresolved-references',
          status: 'warn',
          message: `${unresolvedReferences.length} path reference(s) could not be automatically migrated.`,
        },
  );

  return summarize(items);
}

function containsStaleSourcePath(text: string, sourceContext: PathContext): boolean {
  const needles = [sourceContext.projectRoot, sourceContext.homeDir].filter(
    (v): v is string => !!v && v.length > 2,
  );
  return needles.some((needle) => text.includes(needle));
}

function summarize(items: HealthCheckItem[]): HealthCheckReport {
  return {
    items,
    passed: items.filter((i) => i.status === 'pass').length,
    warnings: items.filter((i) => i.status === 'warn').length,
    failed: items.filter((i) => i.status === 'fail').length,
  };
}
