import * as fs from 'node:fs/promises';
import { walkFiles, looksBinary } from '../utils/filesystem';
import { toPortableRelativePath } from '../utils/paths';
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

  for await (const file of walkFiles(claudePath)) {
    const buffer = await fs.readFile(file.absolutePath);
    if (looksBinary(buffer)) {
      continue;
    }
    const content = buffer.toString('utf8');
    const matches = findAbsolutePaths(content);
    if (matches.length === 0) {
      continue;
    }
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

  return references;
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineNumberForIndex(lineStarts: number[], index: number): number {
  // Binary search for the last line start <= index.
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= index) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}
