# Claude Project Migrator

> **Quick start:** Activity Bar → **Claude Migrator** icon → `Export Sessions...` on the old
> machine, move the `.cmt` file over, then `Claude Migrator: Import Sessions` on the new one.

A VS Code extension that moves two different kinds of Claude data from one machine to another,
rewriting machine-specific paths along the way -- even when the OS, username, home directory,
drive letter, or project path is different:

1. **Claude Code sessions** -- the conversation history Claude Code keeps per project under
   `~/.claude/projects/<encoded-path>/*.jsonl` (plus each project's `memory/` folder). This is
   almost certainly what you mean by "my Claude projects": the sessions the Claude Code VS Code
   extension has open or has ever had open for each of your projects.
2. **Project config** -- a project's own `.claude/` directory (commands, agents, settings) that
   lives inside the project's repository.

Both are exported into the same portable archive format (`.cmt`) and imported with the same
safety machinery: checksum-verified extraction, automatic destination matching, a dry-run preview,
mandatory backups before touching anything that already exists, and a post-import health check.

## What it does

- **Sessions**: scans `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/` if set) for every
  project Claude Code has session history for, using the `cwd` recorded *inside* each session as
  the source of truth for that project's real path (the directory name Claude Code stores sessions
  under is an opaque, one-way hash-like encoding -- see below -- so it's never decoded, only
  reproduced). A sidebar panel (Activity Bar → Claude Migrator) lists every session project, shows
  live status while an export/import runs, and lets you preview a session's conversation before
  deciding what to do with it.
- **Project config**: scans your workspace (or any folder you point it at) for projects containing
  a `.claude` directory.
- Packages selected items into a single portable archive (`.cmt` -- "Claude Migration Transfer"),
  with a versioned manifest, per-file SHA-256 checksums, and a lightweight secret scan before
  anything leaves your machine.
- On another machine, opens that archive, verifies its integrity, automatically matches each
  archived project to a destination folder (via the open workspace, git remote, or folder name),
  and rewrites any machine-specific paths found inside to match the new location -- for sessions,
  that means every `.jsonl` line's `cwd` and any other absolute paths a tool call recorded; for
  project config, everything under `.claude`.
- Never silently overwrites existing data -- it always backs it up first and asks you to choose
  how to proceed.

## Installation

This is not (yet) published to the VS Code Marketplace. Build and install it locally:

```bash
npm install
npm run package        # produces claude-project-migrator-<version>.vsix
code --install-extension claude-project-migrator-0.1.0.vsix
```

## Commands

All commands are under the **Claude Migrator** category in the Command Palette:

| Command | What it does |
| --- | --- |
| `Claude Migrator: Export Sessions` | Exports Claude Code session history (from `~/.claude/projects/`). |
| `Claude Migrator: Import Sessions` | Imports session history from a `.cmt` archive into `~/.claude/projects/`. |
| `Claude Migrator: Export Projects` | Runs the project-config export wizard (scan → select → options → security review → review → save `.cmt`). |
| `Claude Migrator: Import Backup` | Runs the project-config import wizard (select `.cmt` → validate → select projects → match destinations → preview → import). |
| `Claude Migrator: Scan for Claude Projects` | Scans the workspace or a chosen folder for `.claude` project-config directories. |
| `Claude Migrator: Inspect Backup` | Shows a `.cmt` archive's manifest contents (both projects and sessions) without importing anything. |
| `Claude Migrator: Validate Current Project` | Checks the current workspace folder's `.claude` for structural issues and obvious secrets. |
| `Claude Migrator: Export This Project` | Right-click a folder in the Explorer to export just that project's `.claude` config. |
| `Claude Migrator: Delete Sessions` | Deletes session history: pick a project, then either specific sessions or the whole project. |

The **Claude Migrator** sidebar (Activity Bar icon) is a live view over your session projects --
it lists them, lets you export a single project or launch the full export/import wizards, preview
a session's conversation, reveal a project's folder in your OS file browser, delete sessions you
no longer want, and mirrors whatever export/import operation is currently in progress.

## Claude Code sessions workflow

**Export**: `Claude Migrator: Export Sessions` (or the sidebar's "Export Sessions..." button)
scans `~/.claude/projects/`, lets you multi-select which session projects to include, runs the
same security scan and review steps as project-config export (see below), and writes a `.cmt`
(default name `claude-sessions-<date>.cmt`).

**Import**: `Claude Migrator: Import Sessions` opens a `.cmt`, verifies it, lets you pick which
session projects to bring in, auto-matches each one to a destination project folder the same way
project-config import does, and shows a preview before writing anything. The destination directory
under `~/.claude/projects/` is computed by re-running Claude Code's own path-encoding algorithm
against your chosen destination folder -- so imported sessions land exactly where Claude Code
itself will look for them, with no extra registration step. Every `.jsonl` line is treated as an
independent JSON document during migration: a line whose path-replacement would corrupt its JSON
is reverted on its own, without discarding the rest of that session's successfully migrated lines.

### Deleting sessions

Session history is yours and nothing else reads it, so the tool lets you delete it -- from the
sidebar or via `Claude Migrator: Delete Sessions`. Three granularities:

- **One session** -- the trash icon on any session row.
- **Several sessions** -- tick the checkbox on each row, then "Delete Selected (n)".
- **A whole project** -- "Delete Project" in the project's action row, which removes the entire
  `~/.claude/projects/<folder>/` directory.

Every delete shows a modal listing exactly what goes away, and items are moved to the **system
trash** rather than unlinked, so a mistake is recoverable from your OS. Where trashing isn't
supported (some remote/container setups) the tool falls back to a permanent delete and says so in
the result message.

Two behaviors worth knowing:

- A project folder can also hold a `memory/` directory. Deleting the *project* deletes that too;
  the sidebar marks such projects `has memory/` and the confirmation repeats the warning.
  Deleting *sessions* never touches `memory/`.
- Deleting a project's last session leaves an empty folder behind, which the scanner would hide
  but which would still sit on disk -- so an empty folder is pruned afterwards. A folder that
  still contains anything (a `memory/` directory, say) is left alone.

Deletion targets are re-derived from the sessions root and re-validated before anything is
removed: a project must be a direct child of `~/.claude/projects/`, and a session must be a bare
`*.jsonl` name inside one. Paths coming from the webview are never trusted as-is, and the
sidebar re-scans disk before each delete so a stale list can't delete the wrong thing.

### Why the session folder name can't just be decoded

Claude Code names each project's session folder by taking the project's absolute path and
replacing *every* character that isn't `[a-zA-Z0-9]` with `-` (paths longer than 200 characters
get truncated with a hash suffix appended). That means the encoding is intentionally lossy and
one-way -- a literal `-` already in a folder name and a former path separator look identical, so a
folder name alone can't be decoded back into a path with any confidence. This tool never tries:
instead it reads the `cwd` field Claude Code itself records inside each session's `.jsonl` content
(specifically, the most recently modified session's `cwd`) as the authoritative source path, and
re-derives the destination folder name by running the *same* encoding algorithm forward against
wherever you're importing to.

If a session project has no recorded `cwd` at all (rare -- e.g. a session that failed before its
first real turn), its source path is shown as unknown and none of its path references can be
automatically migrated; the files still export and import correctly, just unmodified.

### Re-importing a session (incremental updates)

If a session `.jsonl` already exists at the destination -- most commonly because you already
imported this same archive before, or the same session has kept growing on both machines -- pick
**Merge** at the "already has session data" prompt instead of **Backup and replace**. For `.jsonl`
files specifically, Merge doesn't overwrite the file: it reads both the local file and the
incoming one, matches entries by their `uuid` field, and writes the union back out --

- an entry already present locally (by `uuid`) is left as-is and not duplicated, so re-importing
  the exact same archive twice is a no-op;
- an entry that's only in the incoming file (new messages exported since you last imported) gets
  appended;
- an entry that's only in your local copy (messages added locally since your last export) is kept,
  not dropped.

When every entry in the merged result has a `timestamp` (the normal case), the file is written
back out in chronological order. A backup of the pre-merge file is still taken first, same as
every other destructive change this tool makes.

## Project config export workflow

1. **Find projects** -- the current workspace is scanned automatically; you can also scan a
   specific folder, or (only when you explicitly ask) one of a short list of common developer
   directories for your OS (`~/Projects`, `~/Developer`, etc. -- the extension never scans your
   whole filesystem on its own).
2. **Select projects** -- multi-select which discovered projects to include, with select-all /
   deselect-all and text filtering built into the picker.
3. **Export options** -- portable path migration, the security scan, and compression are on by
   default; including the machine hostname in the manifest is an explicit, off-by-default
   "Advanced" toggle (it's diagnostic-only and never required for migration to work).
4. **Security check** -- every text file under each selected project's `.claude` is scanned for
   patterns that look like API keys, tokens, or private keys. For each flagged file you choose to
   exclude it, replace the detected secrets with `[REDACTED:<rule>]` placeholders, or include it
   anyway. The full secret value is never written to a log.
5. **Review** -- a summary of selected projects, total files/size, detected machine-specific
   references, and any outstanding security warnings, before anything is written to disk.
6. **Export** -- pick a destination `.cmt` file (default name `claude-migration-<date>.cmt`) and
   the archive is written with a progress indicator you can cancel at any time.

## Project config import workflow

1. Pick a `.cmt` file.
2. The archive is validated: readable, manifest present and at a supported format version, and
   every archived file's SHA-256 checksum verified -- before any extraction happens.
3. Select which of the archived projects to import.
4. Each project is automatically matched to a destination using, in order: a matching git remote,
   an existing folder with the same name (a folder that already has a `.claude` scores higher
   confidence), or the single open workspace folder when it's the only candidate. Whenever none of
   these apply with confidence, you're asked to pick a destination folder yourself -- it never
   guesses.
5. A dry-run preview is built for every mapped project: new / modified / preserved file counts,
   how many path references will be rewritten, and any references that couldn't be automatically
   resolved (these are always left untouched and reported, never silently guessed at).
6. If a project's destination already has a `.claude` directory, you choose **Backup and
   replace**, **Merge** (existing files not present in the archive are kept; JSON files are
   merged key-by-key, one level deep), **Skip**, or **Cancel**. A timestamped backup
   (`.claude.backup-<timestamp>`) is always created first whenever an existing `.claude` will be
   touched.
7. After your explicit confirmation of the full preview, the migration is applied with progress
   and cancellation support.
8. A post-import health check runs per project (`.claude` exists, file counts, JSON validity, no
   leftover literal references to the source machine's path) and a final report is shown with
   ✓ / ⚠ / ✗ per check.

## Supported OS

Windows, macOS, and Linux -- as both the export and import side, in any combination, for both
project config and sessions. Path parsing uses Node's `path.win32` / `path.posix` explicitly
rather than assuming the current OS, so e.g. a Windows-authored `.claude` file or session
transcript can be correctly parsed and migrated while running the extension on Linux.

## Archive format (`.cmt`)

A `.cmt` file is a ZIP container (openable with any ZIP tool) with a defined internal layout:

```
manifest.json                # versioned; format version, tool version, source machine info,
                              # a `projects` list (config) and a `sessionProjects` list (sessions)
checksums.json                # archive-path -> SHA-256 hex digest for every archived file
projects/<id>/claude/...      # each selected project's .claude contents, unmodified
sessions/<id>/data/...        # each selected session project's *.jsonl + memory/, unmodified
```

An archive can hold either kind, both, or (in the common case) just one -- the Export
Sessions/Export Projects wizards each populate only their own list, leaving the other empty.
Archives written before session support existed simply have no `sessionProjects` key; this tool
treats that the same as an empty list.

`manifest.json` deliberately omits everything not required to migrate a project: it does not
include the machine's username or full environment, and the hostname is redacted by default
(`"hostname": "redacted"`) unless you opt in to including it under Advanced options. The platform
and home directory *are* always included, because they're required to reconstruct the source
machine's `$HOME` / `$PROJECT_ROOT` context during path migration.

Project identity: each project gets a stable id, preferring one derived from its git remote
(normalized so `git@github.com:org/repo.git` and `https://github.com/org/repo.git` produce the
same id) so the same project is recognized across machines regardless of its filesystem path;
projects without a git remote fall back to an id derived from the project name plus a hash of its
source path.

## Security model

- A lightweight scanner (not an enterprise-grade secret detector) flags patterns that look like
  AWS keys, Anthropic/OpenAI API keys, GitHub/Slack tokens, bearer tokens, PEM private key blocks,
  and generic `key`/`token`/`secret`/`password` assignments. It's meant to catch obvious accidental
  exports, not guarantee nothing sensitive ever leaves the machine -- review the security step's
  findings yourself.
- Detected secrets are always previewed redacted (e.g. `AKIA****MNOP`); the full value is never
  written to the output log or shown in the UI.
- Nothing is uploaded anywhere by this extension. Export writes a local `.cmt` file; you decide
  how to transfer it.
- Checksums are verified before any archive contents are extracted to disk on import, and before
  any destructive change (backup-and-replace, merge) is applied to existing project config or
  session data.

## Path migration behavior

Every absolute path found in a project's text files -- `.claude` config or session `.jsonl` alike
-- is classified against three roots, most specific first: the project root (`$PROJECT_ROOT`), the
workspace root (`$WORKSPACE_ROOT`), and the home directory (`$HOME`). A path that resolves under
one of these is rewritten to the destination's equivalent path in the destination's native
separator style; a path that doesn't match any known root is left completely untouched and
reported as an unresolved reference in the migration preview and the final report -- the extension
never guesses at a replacement.

JSON files (`.json`, and each line of a `.jsonl`) are only ever rewritten if the result still
parses as valid JSON (backslashes in a Windows destination path are correctly JSON-escaped); if
that check fails, the affected unit is left unmodified as a safety fallback rather than risking
corrupted config or a corrupted session transcript.

Binary files are copied byte-for-byte and are never scanned or modified.

## Limitations (MVP scope)

- Unresolved path references are reported but not manually re-mappable from within the import
  wizard -- if the extension can't confidently classify a reference, you'll see it flagged in the
  preview and the final report and can edit that file yourself afterward. A guided per-reference
  "replace" UI is a natural next step but is out of scope for this MVP.
- JSON merging for the **Merge** import strategy is a one-level-deep structural merge (incoming
  keys win, nested objects merge one level further); it is not a full three-way/semantic merge.
  `.jsonl` session transcripts merge differently (see "Re-importing a session" below): by entry
  identity (`uuid`), not by key.
- Full functionality (scanning, reading, and writing) requires the extension host's filesystem to
  be the one you actually want to operate on. In VS Code Remote (SSH / WSL / Dev Containers), this
  extension runs on the remote/container filesystem, not your local machine -- exporting *from* a
  remote workspace archives files on that remote host, and you'd still need to move the resulting
  `.cmt` file to wherever you plan to import it.
- The secret scanner is intentionally simple (regex-based) and does not claim complete coverage.
- Session projects with no `cwd` ever recorded in any of their `.jsonl` files (source path
  "unknown") export and import correctly but can't have their path references migrated -- there's
  nothing to migrate *from*.
- The sidebar is read/preview/launch-only for sessions; project-selection for an export or import
  still happens in the wizard's QuickPick (a single "Export this project" button per sidebar item
  bypasses that step for one project at a time).

## Development

```bash
npm install
npm run watch          # esbuild --watch
```

Press `F5` in VS Code (with this folder open) to launch an Extension Development Host.

## Testing

```bash
npm run typecheck
npm run lint
npm test               # vitest unit tests (123 tests covering path resolution across every
                        # Windows/macOS/Linux source-destination combination, the session
                        # path-encoding algorithm, session discovery via recorded cwd, archive
                        # round-trips and checksum verification for both project config and
                        # sessions, the migration engine's backup/merge/rollback behavior
                        # (including per-line .jsonl handling), project discovery including
                        # nested projects, ignored directories and symlink loops, and more)
```

Unit tests run against plain Node.js and fixtures under `test/fixtures/` -- they don't require a
VS Code host. UI-level flows (the wizards themselves) are exercised manually via `F5` since they
depend on interactive VS Code APIs (QuickPick, OpenDialog, etc.).

## Packaging

```bash
npm run package         # runs the production esbuild bundle, then vsce package --no-dependencies
```

Produces `claude-project-migrator-<version>.vsix` in the project root.
