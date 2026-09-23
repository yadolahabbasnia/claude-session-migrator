import { normalizeRemoteUrl } from '../discovery/gitDetector';
import type { DestinationMapping } from '../models/migration';

export interface DestinationCandidate {
  path: string;
  name: string;
  remoteUrls?: string[];
  hasClaudeDir?: boolean;
  isCurrentWorkspaceFolder?: boolean;
}

/** The subset of an archived entry (project-config or session-project) that matching needs. */
export interface MatchableEntry {
  id: string;
  name: string;
  git?: { remoteUrls: string[] };
}

/**
 * Attempts to automatically match an archived project to a destination folder using, in
 * priority order: (1) the currently open workspace when there's an unambiguous single
 * candidate, (2) a matching git remote, (3) an existing folder with the same name, (4) an
 * existing folder that already has a `.claude` directory with the same name. Never picks a
 * destination it isn't reasonably confident about -- the caller should prompt the user
 * whenever `confidence` comes back `'none'`.
 */
export function matchDestination(
  project: MatchableEntry,
  candidates: DestinationCandidate[],
): DestinationMapping {
  const projectRemotes = new Set((project.git?.remoteUrls ?? []).map(normalizeRemoteUrl));

  if (projectRemotes.size > 0) {
    const gitMatch = candidates.find((c) =>
      (c.remoteUrls ?? []).some((url) => projectRemotes.has(normalizeRemoteUrl(url))),
    );
    if (gitMatch) {
      return {
        projectId: project.id,
        destinationPath: gitMatch.path,
        matchedBy: 'git-remote',
        confidence: 'high',
      };
    }
  }

  const nameMatches = candidates.filter(
    (c) => c.name.toLowerCase() === project.name.toLowerCase(),
  );
  if (nameMatches.length === 1) {
    return {
      projectId: project.id,
      destinationPath: nameMatches[0].path,
      matchedBy: nameMatches[0].hasClaudeDir ? 'existing-claude' : 'existing-folder-name',
      confidence: nameMatches[0].hasClaudeDir ? 'high' : 'medium',
    };
  }

  const currentWorkspaceCandidates = candidates.filter((c) => c.isCurrentWorkspaceFolder);
  if (currentWorkspaceCandidates.length === 1 && candidates.length === 1) {
    return {
      projectId: project.id,
      destinationPath: currentWorkspaceCandidates[0].path,
      matchedBy: 'current-workspace',
      confidence: 'medium',
    };
  }

  return { projectId: project.id, confidence: 'none' };
}
