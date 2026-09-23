import * as path from 'node:path';
import {
  findAbsolutePaths,
  toPortablePath,
  resolvePortablePath,
  type PathContext,
} from './pathResolver';

export interface UnresolvedMatch {
  originalPath: string;
  index: number;
}

export interface TransformResult {
  content: string;
  replacements: number;
  unresolved: UnresolvedMatch[];
  /** True if this is a JSON/JSONL file and at least one JSON unit's replacement would have
   * produced invalid JSON, so that unit's original text was kept unmodified as a safety
   * fallback (for `.json` this means the whole file; for `.jsonl` only the affected line(s)). */
  jsonValidationFailed: boolean;
}

/**
 * Rewrites machine-specific absolute paths found in `content` from the source machine's
 * layout to the destination machine's layout. Only paths that can be confidently classified
 * (under $PROJECT_ROOT, $HOME, or $WORKSPACE_ROOT) and resolved at the destination are
 * replaced; everything else is left untouched and reported as unresolved.
 *
 * `.jsonl` files (one independent JSON object per line, as used by Claude Code session
 * transcripts) are transformed line-by-line: a line whose replacement would corrupt its JSON is
 * reverted individually rather than discarding the whole file's other, valid replacements.
 */
export function transformFileContent(
  relativePath: string,
  content: string,
  sourceContext: PathContext,
  destContext: PathContext,
): TransformResult {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.jsonl') {
    return transformJsonLines(content, sourceContext, destContext);
  }
  return transformUnit(content, sourceContext, destContext, ext === '.json');
}

function transformJsonLines(
  content: string,
  sourceContext: PathContext,
  destContext: PathContext,
): TransformResult {
  const lines = content.split('\n');
  const outputLines: string[] = [];
  const unresolved: UnresolvedMatch[] = [];
  let replacements = 0;
  let jsonValidationFailed = false;
  let cursor = 0;

  for (const originalLine of lines) {
    const lineResult = transformUnit(originalLine, sourceContext, destContext, true);
    outputLines.push(lineResult.content);
    replacements += lineResult.replacements;
    if (lineResult.jsonValidationFailed) {
      jsonValidationFailed = true;
    }
    for (const u of lineResult.unresolved) {
      unresolved.push({ originalPath: u.originalPath, index: cursor + u.index });
    }
    cursor += originalLine.length + 1; // +1 for the '\n' the split() consumed
  }

  return { content: outputLines.join('\n'), replacements, unresolved, jsonValidationFailed };
}

/** Transforms a single JSON unit -- either a whole `.json` file's content or one `.jsonl` line. */
function transformUnit(
  content: string,
  sourceContext: PathContext,
  destContext: PathContext,
  isJson: boolean,
): TransformResult {
  const matches = findAbsolutePaths(content);
  if (matches.length === 0) {
    return { content, replacements: 0, unresolved: [], jsonValidationFailed: false };
  }

  const unresolved: UnresolvedMatch[] = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (const match of matches) {
    const portable = toPortablePath(match.text, sourceContext);
    const resolved = portable ? resolvePortablePath(portable, destContext) : undefined;
    if (!portable || !resolved) {
      unresolved.push({ originalPath: match.text, index: match.index });
      continue;
    }
    // Path text is always found inside a quoted JSON string value, so backslashes (e.g. from
    // a Windows destination) must be JSON-escaped or the splice will corrupt the document.
    const replacement = isJson ? escapeForJsonString(resolved) : resolved;
    edits.push({ start: match.index, end: match.index + match.text.length, replacement });
  }

  if (edits.length === 0) {
    return { content, replacements: 0, unresolved, jsonValidationFailed: false };
  }

  edits.sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const edit of edits) {
    result += content.slice(cursor, edit.start);
    result += edit.replacement;
    cursor = edit.end;
  }
  result += content.slice(cursor);

  if (isJson && result.trim().length > 0) {
    try {
      JSON.parse(result);
    } catch {
      // Refuse to write JSON we can't validate -- keep the original content untouched.
      return {
        content,
        replacements: 0,
        unresolved: matches.map((m) => ({ originalPath: m.text, index: m.index })),
        jsonValidationFailed: true,
      };
    }
  }

  return { content: result, replacements: edits.length, unresolved, jsonValidationFailed: false };
}

function escapeForJsonString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface JsonlMergeResult {
  content: string;
  /** Entries from `incomingText` that weren't already present in `existingText`. */
  addedCount: number;
}

interface JsonlEntry {
  raw: string;
  key: string;
  timestamp?: string;
}

/**
 * Merges two `.jsonl` transcripts (e.g. re-importing a session that already exists locally,
 * possibly because the same session kept growing on both machines) into their union, instead of
 * one file overwriting the other. Entries are identified by their `uuid` field when present
 * (falling back to the raw line itself), so re-importing the same archive twice is a no-op, and
 * entries that exist locally but weren't in the incoming file (e.g. messages added locally since
 * the last export) are preserved. When every entry has a `timestamp`, the merged result is
 * ordered chronologically; otherwise existing entries keep their order and new ones are appended.
 */
export function mergeJsonlContent(existingText: string, incomingText: string): JsonlMergeResult {
  const existingEntries = parseJsonlEntries(existingText);
  const incomingEntries = parseJsonlEntries(incomingText);

  const merged = new Map<string, JsonlEntry>();
  const order: string[] = [];
  let addedCount = 0;

  for (const entry of existingEntries) {
    if (!merged.has(entry.key)) {
      merged.set(entry.key, entry);
      order.push(entry.key);
    }
  }
  for (const entry of incomingEntries) {
    if (!merged.has(entry.key)) {
      merged.set(entry.key, entry);
      order.push(entry.key);
      addedCount += 1;
    }
  }

  const entries = order.map((key) => merged.get(key)!);
  const canSortByTime = entries.length > 0 && entries.every((e) => typeof e.timestamp === 'string');
  if (canSortByTime) {
    entries.sort((a, b) => a.timestamp!.localeCompare(b.timestamp!));
  }

  const content = entries.length > 0 ? entries.map((e) => e.raw).join('\n') + '\n' : '';
  return { content, addedCount };
}

function parseJsonlEntries(text: string): JsonlEntry[] {
  const entries: JsonlEntry[] = [];
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) {
      continue;
    }
    let key = rawLine;
    let timestamp: string | undefined;
    try {
      const parsed = JSON.parse(rawLine) as { uuid?: unknown; timestamp?: unknown };
      if (typeof parsed.uuid === 'string' && parsed.uuid.length > 0) {
        key = parsed.uuid;
      }
      if (typeof parsed.timestamp === 'string') {
        timestamp = parsed.timestamp;
      }
    } catch {
      // Not parseable JSON -- fall back to using the raw line as its own identity key.
    }
    entries.push({ raw: rawLine, key, timestamp });
  }
  return entries;
}
