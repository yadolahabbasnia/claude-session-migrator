import * as path from 'node:path';

/** Low-level, OS-agnostic path parsing. Callers pass the *style* of the path being examined
 * rather than relying on the current process's platform, so we can correctly parse a Windows
 * path while running on Linux/macOS and vice versa. */
export type PathStyle = 'win32' | 'posix';

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATTERN = /^\\\\[^\\]+\\[^\\]+/;

/** Heuristically detects whether a path string looks like a Windows or POSIX path. */
export function detectPathStyle(candidate: string): PathStyle {
  if (WINDOWS_DRIVE_PATTERN.test(candidate) || WINDOWS_UNC_PATTERN.test(candidate)) {
    return 'win32';
  }
  if (candidate.startsWith('/')) {
    return 'posix';
  }
  // Fallback: prefer backslash presence as a signal of Windows-style paths.
  return candidate.includes('\\') && !candidate.includes('/') ? 'win32' : 'posix';
}

function impl(style: PathStyle): path.PlatformPath {
  return style === 'win32' ? path.win32 : path.posix;
}

export function isAbsoluteForeign(candidate: string, style: PathStyle): boolean {
  return impl(style).isAbsolute(candidate);
}

export function normalizeForeign(candidate: string, style: PathStyle): string {
  return impl(style).normalize(candidate);
}

export function joinForeign(style: PathStyle, ...segments: string[]): string {
  return impl(style).join(...segments);
}

export function relativeForeign(style: PathStyle, from: string, to: string): string {
  return impl(style).relative(from, to);
}

export function splitSegments(candidate: string, style: PathStyle): string[] {
  const normalized = normalizeForeign(candidate, style);
  const sep = style === 'win32' ? /[\\/]/ : /\//;
  return normalized.split(sep).filter((segment) => segment.length > 0);
}

/** Case-insensitive on Windows-style paths (NTFS is case-preserving but case-insensitive by
 * default), case-sensitive on POSIX. */
export function pathsEqual(a: string, b: string, style: PathStyle): boolean {
  const normA = normalizeForeign(a, style);
  const normB = normalizeForeign(b, style);
  return style === 'win32' ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

/**
 * If `candidate` is located under `ancestor` (in the same path style), returns the remaining
 * relative segments joined with POSIX separators (`/`). Returns undefined otherwise.
 */
export function relativeIfUnder(
  candidate: string,
  ancestor: string,
  style: PathStyle,
): string | undefined {
  if (!ancestor) {
    return undefined;
  }
  const candidateSegments = splitSegments(candidate, style);
  const ancestorSegments = splitSegments(ancestor, style);
  if (ancestorSegments.length === 0 || candidateSegments.length < ancestorSegments.length) {
    return undefined;
  }
  for (let i = 0; i < ancestorSegments.length; i++) {
    const a = style === 'win32' ? ancestorSegments[i].toLowerCase() : ancestorSegments[i];
    const c = style === 'win32' ? candidateSegments[i].toLowerCase() : candidateSegments[i];
    if (a !== c) {
      return undefined;
    }
  }
  return candidateSegments.slice(ancestorSegments.length).join('/');
}

/** Converts a portable, forward-slash relative path into a native path for the current process. */
export function toNativePath(relativePosixPath: string): string {
  const segments = relativePosixPath.split('/').filter((s) => s.length > 0);
  return path.join(...segments);
}

/** Converts a native path's relative segments into a portable forward-slash form for storage. */
export function toPortableRelativePath(relativeNativePath: string): string {
  return relativeNativePath.split(path.sep).join('/');
}
