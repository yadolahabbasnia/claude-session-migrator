/**
 * Reproduces Claude Code's own project-directory-name encoding exactly (verified against the
 * installed `anthropic.claude-code` extension bundle), so sessions imported by this tool land
 * in precisely the directory name Claude Code itself expects for a given project path -- no
 * separate "registration" step is needed for Claude Code to pick them up.
 *
 * The encoding is intentionally simple and LOSSY: every character that isn't `[a-zA-Z0-9]`
 * (including `/`, `\`, `:`, `.`, `_`, spaces, ...) becomes `-`. This means it is NOT safely
 * reversible -- a folder name alone cannot be decoded back into the original path with
 * confidence (e.g. a literal `-` in a folder name and a path separator are indistinguishable).
 * Callers must treat the encoded name as opaque and instead recover the true source path from
 * the `cwd` field recorded inside each session's own `.jsonl` content (see sessionScanner.ts).
 */

const MAX_ENCODED_LENGTH = 200;

export function encodeProjectPath(absolutePath: string): string {
  const encoded = absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
  if (encoded.length <= MAX_ENCODED_LENGTH) {
    return encoded;
  }
  return `${encoded.slice(0, MAX_ENCODED_LENGTH)}-${rollingHash36(absolutePath)}`;
}

/** 32-bit rolling string hash (the classic Java `String.hashCode()` algorithm), base-36. */
function rollingHash36(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
