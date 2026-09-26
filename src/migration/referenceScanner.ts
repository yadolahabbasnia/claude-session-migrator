import * as fs from 'node:fs/promises';
import { walkFiles, looksBinary } from '../utils/filesystem';
import { toPortableRelativePath } from '../utils/paths';
import { computeLineStarts, lineNumberForIndex } from '../utils/text';
import { createPeriodicYielder } from '../utils/async';
import { findAbsolutePaths, toPortablePath, classifyPortablePath, type PathContext } from './pathResolver';
import type { PathReference } from '../models/migration';

/**
 * Scans every text file under a .claude directory for machine-specific absolute path
 * references, without modifying anything. Binary files are skipped entirely.
 */
export async function scanProjectReferences(
  claudePath: string,
  context: PathContext,
): Promise<PathReference[]> {
  const references: PathReference[] = [];
  const yieldPeriodically = createPeriodicYielder();

  for await (const file of walkFiles(claudePath)) {
    const buffer = await fs.readFile(file.absolutePath);
    if (looksBinary(buffer)) {
      await yieldPeriodically();
      continue;
    }
    const content = buffer.toString('utf8');
    const matches = findAbsolutePaths(content);
    if (matches.length > 0) {
      const lineStarts = computeLineStarts(content);
      for (const match of matches) {
        const line = lineNumberForIndex(lineStarts, match.index);
        const portable = toPortablePath(match.text, context);
        references.push({
          file: toPortableRelativePath(file.relativePath),
          line,
          originalPath: match.text,
          portablePath: portable,
          kind: classifyPortablePath(match.text, context),
        });
      }
    }
    await yieldPeriodically();
  }

  return references;
}
