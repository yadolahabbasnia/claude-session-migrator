import type { PortableToken } from '../models/migration';
import {
  type PathStyle,
  detectPathStyle,
  isAbsoluteForeign,
  relativeIfUnder,
  joinForeign,
} from '../utils/paths';

export interface PathContext {
  projectRoot: string;
  homeDir: string;
  workspaceRoot?: string;
  style: PathStyle;
}

const TOKEN_PATTERN = /^\$(PROJECT_ROOT|HOME|WORKSPACE_ROOT)(?:\/(.*))?$/;

/**
 * Converts an absolute, machine-specific path into a portable token representation
 * (e.g. "$PROJECT_ROOT/data/cache.json"), preferring the most specific matching root.
 * Returns undefined if the path isn't under any known root (unclassified).
 */
export function toPortablePath(absolutePath: string, context: PathContext): string | undefined {
  const candidates: Array<{ token: PortableToken; root: string | undefined }> = [
    { token: '$PROJECT_ROOT', root: context.projectRoot },
    { token: '$WORKSPACE_ROOT', root: context.workspaceRoot },
    { token: '$HOME', root: context.homeDir },
  ];

  const defined = candidates.filter(
    (c): c is { token: PortableToken; root: string } => !!c.root && c.root.length > 0,
  );
  defined.sort((a, b) => b.root.length - a.root.length);

  for (const candidate of defined) {
    const rel = relativeIfUnder(absolutePath, candidate.root, context.style);
    if (rel !== undefined) {
      return rel.length > 0 ? `${candidate.token}/${rel}` : candidate.token;
    }
  }
  return undefined;
}

/** Classifies which root a portable path (or raw absolute path) corresponds to. */
export function classifyPortablePath(
  portableOrAbsolute: string,
  context: PathContext,
): 'home' | 'project-root' | 'workspace-root' | 'absolute-unclassified' {
  const tokenMatch = portableOrAbsolute.match(TOKEN_PATTERN);
  if (tokenMatch) {
    switch (tokenMatch[1]) {
      case 'PROJECT_ROOT':
        return 'project-root';
      case 'HOME':
        return 'home';
      case 'WORKSPACE_ROOT':
        return 'workspace-root';
    }
  }
  const portable = toPortablePath(portableOrAbsolute, context);
  if (portable) {
    return classifyPortablePath(portable, context);
  }
  return 'absolute-unclassified';
}

/**
 * Resolves a portable token path against a destination context, producing an absolute path
 * native to the destination style. Returns undefined if the referenced root isn't known at
 * the destination (e.g. $WORKSPACE_ROOT but no workspace root was supplied).
 */
export function resolvePortablePath(
  portablePath: string,
  destination: PathContext,
): string | undefined {
  const match = portablePath.match(TOKEN_PATTERN);
  if (!match) {
    return undefined;
  }
  const [, tokenName, rest] = match;
  const rootByToken: Record<string, string | undefined> = {
    PROJECT_ROOT: destination.projectRoot,
    HOME: destination.homeDir,
    WORKSPACE_ROOT: destination.workspaceRoot ?? destination.projectRoot,
  };
  const root = rootByToken[tokenName];
  if (!root) {
    return undefined;
  }
  if (!rest) {
    return root;
  }
  const segments = rest.split('/').filter((s) => s.length > 0);
  return joinForeign(destination.style, root, ...segments);
}

export interface AbsolutePathMatch {
  text: string;
  index: number;
  style: PathStyle;
}

// Matches Windows drive-letter paths (C:\..., C:/...) and UNC paths (\\host\share\...). The
// leading lookbehind stops "https:" from being misread as a one-letter drive ("s:").
const WINDOWS_PATH_PATTERN = /(?:(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'`<>|]*|\\\\[^\s"'`<>|]+)/g;
// Matches POSIX absolute paths, avoiding URL schemes like http:// , relative "./" references,
// and values that are just "/".
const POSIX_PATH_PATTERN = /(?<![:/\w.])\/(?:[^\s"'`<>|:]+\/)*[^\s"'`<>|:]+/g;

/** Finds absolute filesystem paths (Windows or POSIX) embedded in arbitrary text content. */
export function findAbsolutePaths(text: string): AbsolutePathMatch[] {
  const matches: AbsolutePathMatch[] = [];
  const seenRanges = new Set<string>();

  for (const pattern of [WINDOWS_PATH_PATTERN, POSIX_PATH_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const trimmed = trimTrailingPunctuation(raw);
      if (trimmed.length < 2) {
        continue;
      }
      const style = detectPathStyle(trimmed);
      if (!isAbsoluteForeign(trimmed, style)) {
        continue;
      }
      const key = `${match.index}:${trimmed.length}`;
      if (seenRanges.has(key)) {
        continue;
      }
      seenRanges.add(key);
      matches.push({ text: trimmed, index: match.index, style });
    }
  }

  return matches.sort((a, b) => a.index - b.index);
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:'")\]}]+$/, '');
}
