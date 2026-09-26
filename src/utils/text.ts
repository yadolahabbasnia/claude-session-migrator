/** Precomputes the character offset of the start of every line in `content`, so individual
 * character-offset -> line-number lookups can be done in O(log n) instead of re-scanning the
 * whole string per lookup -- important for files with many matches (e.g. a tool-result blob with
 * dozens of embedded paths) or very large single lines. */
export function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Binary search for the 1-based line number containing character offset `index`, given the
 * result of `computeLineStarts`. */
export function lineNumberForIndex(lineStarts: number[], index: number): number {
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
