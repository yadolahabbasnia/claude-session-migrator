# Changelog

## 0.2.0

### Added
- **Sync sessions through git.** Push and pull session history through a dedicated git repository
  (`Sync Sessions via Git`), with one archive per machine so machines never overwrite each other.
- **Auto-sync.** In git mode the extension watches `~/.claude/projects` and pushes shortly after
  changes settle. It can be paused and resumed from the sidebar.
- **Change repo / local only.** Switch the sync repository at any time, or go back to local-only
  without deleting anything.
- **Multiple Claude accounts.** When more than one Claude Code config directory is found, you are
  asked which one to sync.
- **Merge Session Backups.** Fold leftover `.backup-<timestamp>` folders from earlier imports back
  into their project, never overwriting live sessions.
- **Redesigned sidebar** with a sync status card (mode, auto-sync state, last push, remote status,
  archives, problems), totals, project cards, a filter, and a *More tools* section that exposes every
  command.

### Fixed
- Auto-sync no longer drops whole session files that look like they contain secrets; the secret text
  is redacted in place instead. This could shrink the pushed archive to almost nothing.
- Machines no longer overwrite one shared archive.
- A failing `git pull` is reported instead of being silently ignored.
- Dismissing the secret-review prompt cancels the export instead of excluding the file.
- Push asks for confirmation (auto-sync skips) when the new archive is less than half the size of the
  previous one.
- Choosing a non-empty folder for the sync checkout no longer wedges the settings.

## 0.1.0

- Initial release: export and import Claude Code sessions and project `.claude` config as `.cmt`
  archives with path migration, backups, previews and health checks.
