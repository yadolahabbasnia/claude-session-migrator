/** Local (never archived) record of what a past import wrote to disk, so it can be undone later. */

export type ImportedKind = 'project-config' | 'session';

export interface ImportLogEntry {
  /** Unique id for this log entry (distinct from the archived project/session id). */
  id: string;
  kind: ImportedKind;
  label: string;
  /** The .claude (or sessions) directory that was written to. */
  destinationContentDir: string;
  /** Pre-import backup of destinationContentDir, if one was made because it already existed. */
  backupPath?: string;
  /** Whether destinationContentDir already existed before this import wrote to it. */
  existedBefore: boolean;
  importedAt: string;
}

export function isImportLogEntry(value: unknown): value is ImportLogEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ImportLogEntry>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.kind === 'project-config' || candidate.kind === 'session') &&
    typeof candidate.label === 'string' &&
    typeof candidate.destinationContentDir === 'string' &&
    typeof candidate.existedBefore === 'boolean' &&
    typeof candidate.importedAt === 'string'
  );
}
