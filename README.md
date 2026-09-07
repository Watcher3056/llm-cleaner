# Context Bonsai

**Trim the history. Keep the context.**

An interactive local chat-storage cleaner for Codex, Claude Code, Cursor, Gemini CLI and Antigravity. Review savings, prune supported histories, remove old chats and keep or restore verified backups.

Node.js **24 LTS** recommended; no npm packages. Windows and Linux/WSL tested. macOS paths and portable logic are covered, but no native macOS test was available.

## Start

**Windows: double-click `Start-Windows.cmd`.** The launcher offers analysis/cleanup mode, numbered drives with free space and a graphical backup-folder picker. No command-line arguments are needed. It checks Node.js and keeps the window open after completion/errors.

Optional command-line usage from an external terminal:

```powershell
# Windows: interactive workflow
.\Run-Cleaner.ps1 -BackupDir 'D:\Chat-storage-backups'
# Windows: analysis only
.\Run-Cleaner.ps1 -ScanOnly
```

```sh
# Linux / macOS
sh ./run-cleaner.sh --backup-dir /path/on/another/disk/chat-backups
# All platforms
node chat-storage.cjs --scan-only
node chat-storage.cjs --help
```

The script detects running applications and offers to close the selected application before mutations. Save your work first. A yes/no question requests normal closure; forced termination requires a second, separate confirmation if processes remain. A cleaner launched inside its target application refuses to close its own host; use an external terminal. Scanning works while applications are open, but figures can change. Do not restart a selected application until the script finishes.

The default backup location is `~/Documents/Chat-storage-backups`. **Prefer another disk**: archives on the source disk reduce net savings, and a nearly full disk can prevent the first backup.

## Workflow

1. Analyze all five systems; show logical chat-storage size, stored bytes where available, and estimated cleanup savings. Cursor/Antigravity overview estimates refer to SQLite vacuum; history and age-deletion estimates are calculated when those separate actions are selected.
2. Select one application, then one action. Main-chat compaction is a separate opt-in; age-based deletion offers 3, 6 or 12 months since last activity. Each mutation requires confirmation.
3. Make and verify gzip backups before replacements. Report actual logical/stored savings, percentages, backup space and errors.
4. Windows only: offer NTFS compression independently, even for a system with no cleanup. Select systems, then separately confirm compression with a yes/no question.
5. Measure compression savings after the action, report additional bytes/percentage, and save stage results in `storage-report.json`.
6. Finish: keep backups (default), restore this run, or permanently delete its backups. Restore and deletion each require confirmation. Final totals include remaining backup space.

Use Up/Down and Enter to select; Escape returns or declines. Destructive confirmations default to No. Numeric shortcuts are also accepted. No `--yes` option. Noninteractive terminals may use `--scan-only`, but cannot approve changes.

## Operations

**Codex:** scans `sessions` and `archived_sessions`. Subagents qualify by default. The separate MAIN chat action also considers recognized main sessions. Keeps the last full `compacted.payload.replacement_history`, all bytes after it, and preceding service records (`session_meta`, `turn_context`, `world_state`, `inter_agent_communication_metadata`). Main chats and ordinary forks are untouched unless MAIN chat compaction is explicitly selected. Invalid JSON, unknown records, missing checkpoints, post-checkpoint rollbacks and changed files are skipped. Reanalyzes candidates before applying even when stat-validated estimates were cached. Preserves mode and timestamps.

**Claude Code:** scans project and subagent JSONL transcripts. Keeps the last root `compact_boundary`, its `isCompactSummary`, every following record and preceding non-message metadata. Resolves `preservedMessages` / `preservedSegment` anchors, parent chains, split assistant blocks and tool results. Missing references or summaries block pruning. Files without a checkpoint remain intact: inventing a summary would require running a model and would not preserve the existing checkpoint. Transcripts without a valid checkpoint have zero pruning savings. Claude desktop/web history is separate and is not rewritten.

**Gemini CLI:** removes intermediate, superseded versions of messages in the JSONL append journal. Keeps first/last versions per ID per rewind epoch and all metadata/rewind records. Compares replay state before/after, including message order, first prompt and scratchpad freshness. Does not delete surviving messages or invent compaction summaries. Unknown records are rejected; legacy non-JSONL files are not rewritten.

**Antigravity:** supports authenticated encrypted `.pb` trajectories in the verified format. Replaces checkpoint-covered old message payloads with native DUMMY records, preserving ordinal positions, metadata, all incremental checkpoint summaries and the unsummarized tail. Keeping only the last summary would lose earlier knowledge. Main and subagent cleanup are separate. Incoming trajectory dependencies are protected; unreadable payloads block pruning/deletion because dependencies cannot be checked. Unknown formats, including alternative database-based conversation stores, are not rewritten. Brain artifacts, worktrees and project files remain. SQLite vacuum is a separate operation.

**Cursor:** main/subagent pruning retains a complete conversation summary, its boundary, subsequent messages, the first human message and required referenced messages. Supports verified legacy and modern composer layouts; modern serialized agent context remains byte-for-byte unchanged. Shared agentKv blobs and file/code checkpoints remain, so not every old byte is reclaimable. Unsupported external backends and dependency-linked chats are skipped. A separate SQLite vacuum action preserves every logical record and schema. Mutations back up database/WAL files, checkpoint SQLite, edit a temporary copy, verify integrity and replace the database.

**NTFS:** existing chat files on Windows NTFS volumes only; no ZIP substitution on other platforms, no `/EXE` mode and no recursive whole-folder compression. Uses native `compact.exe` with SHA-256 before/after to verify contents. Already-compressed files and non-NTFS volumes are skipped. Future files do not automatically inherit compression.

The survey excludes extensions, repositories, worktrees and unrelated caches. It is local to the OS/user running it; other WSL users and remote machines are not silently scanned.

## Measurements and limits

Estimates use logical sizes. Windows stored-byte measurement uses `GetCompressedFileSizeW`; uncompressed files report logical size, so it is not exact cluster accounting. POSIX uses `stat.blocks * 512`. Hard links, APFS clones, filesystem metadata and unrelated disk activity are not a global free-space ledger. Backups are reported separately; gross source savings differ from net savings if backups share the disk.

Room is needed for a verified backup and one temporary reduced/compacted file. On errors a stage stops and reports partial results. Completed replacements stay applied, with backups retained. SQLite checkpointing may have occurred before a later replacement failure; this changes physical representation, not logical records.

Formats can change. This is a local maintenance utility, not an official vendor command. Current context is preserved, not all historical detail; removed details remain in backups. Process guards and hashes reduce races but cannot defend against another program deliberately writing these files during maintenance.

## Paths

Defaults: `CODEX_HOME` or `~/.codex`; `CLAUDE_CONFIG_DIR` or `~/.claude`; `~/.cursor`. Cursor databases: `%APPDATA%/Cursor/User` on Windows; `~/Library/Application Support/Cursor/User` on macOS; `$XDG_CONFIG_HOME/Cursor/User` or `~/.config/Cursor/User` on Linux.

Overrides: `--codex-home`, `--claude-home`, `--cursor-home`, `--cursor-user`, `--gemini-home`, `--antigravity-home`, `--antigravity-user`, `--backup-dir`, `--report`.

Gemini defaults to `(GEMINI_CLI_HOME or home)/.gemini`; Antigravity to `~/.gemini/antigravity`, with databases under the platform application-data directory `Antigravity/User`. Use `--antigravity-user` for installations named `Antigravity IDE`.

The original `clean-subagents.cjs` is the Codex-only engine. Use `chat-storage.cjs` or the launchers for the combined workflow.

## Validation

```sh
node --test test.cjs storage-test.cjs transcript-test.cjs friendly-test.cjs lifecycle-test.cjs terminal-ui-test.cjs ide-history-test.cjs
```

- Native Linux Codex CLI 0.145.0: 15 successful `exec resume` runs on 3 real subagents, one full main chat and one parent excerpt. Interactive cleanup, exact checkpoint/tail bytes, full restored input equality (only isolated home paths normalized), verified backups, saved responses and second resumes all passed. Responses came from a local deterministic transport, not a remote model. Windows originals remained unchanged.
- Installed Codex read and resumed a reduced real subagent after its parent loaded, in an isolated home. No model turn was sent.
- A real Cursor workspace DB copy shrank from 1,941,504 to 401,408 bytes; all logical records, schema and rowids matched. The source hash stayed unchanged. Fixtures also cover blobs and composer headers.
- Claude Agent SDK 0.3.263 `getSessionMessages` loads identical messages from original/reduced fixtures for full compaction, preserved messages and preserved segments. Set `CLAUDE_SDK_PATH` to a locally installed `sdk.mjs` to repeat those optional vendor comparisons in the tests.
- All 11 reducible local Gemini sessions were validated with installed Gemini CLI 0.43.0-preview.1 `loadConversationRecord`: full restored state identical, originals SHA-256 unchanged. Total removable journal data: 731,517,792 bytes (~697.63 MiB).
- Automatic process closure was exercised on a disposable child CLI process; no user applications were terminated.
- Native NTFS compression reduced a disposable file's stored size with identical SHA-256.
- Windows and native Linux/WSL tests cover confirmation/cancellation, checkpoints, backups, SQLite replacement, metadata and repeat runs. Native macOS has not been verified.

## Backups and restore

At the end choose Keep (default), Restore, or Delete backups. Restore verifies every archive and refuses to overwrite files changed since cleanup. It restores original bytes, permissions and timestamps; backups remain available. Delete removes only registered backups from this run; older backups and unrelated files remain. The manifest records original paths and SHA-256 hashes. Keep applications closed until the operation completes. Restoration after leaving the wizard is manual using the manifest and matching database/WAL files.

## Old chats

All five applications offer deletion by last activity: more than 3 months, 6 months or 1 year. The cutoff uses calendar months and the newest recorded activity or file modification time. A short preview appears before confirmation. Codex uses its native app-server deletion API and backs up its session catalogue as well as transcripts. An installed Codex CLI is required. Parents with dependent chats and unsupported sidecar layouts are protected. Cursor removes the selected composer, owned message/checkpoint rows, catalogue references and matching exported transcripts. Shared blobs remain. Antigravity removes selected encrypted payloads and updates recognized trajectory/session indexes. Other chats and project files remain. Cloud/worktree or dependent chats are protected where identified.

## Speed and test scope

Independent transcript work runs with two workers. Database operations remain sequential. Windows process checks reuse one PowerShell process while still checking before mutations. Progress displays completed files and reclaimed bytes. There is no verified whole-dataset speedup estimate.

The final version passed 46/46 tests on Ubuntu WSL2. Windows passed 44 tests with zero failures; two mutation tests were skipped because the respective user applications were running. Native Linux Cursor loaded five real chats before and after pruning with identical loaded message/summary maps and no corrupted checkpoints. Native Antigravity loaded and exported three pruned real trajectories, with every retained step identical. See VALIDATION.md for versions, measured savings and test limits.

## Sources

- https://code.claude.com/docs/en/sessions
- https://www.sqlite.org/lang_vacuum.html
- https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/compact
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getcompressedfilesizew

- https://geminicli.com/docs/cli/session-management/
- Claude reader implementation: official npm package `@anthropic-ai/claude-agent-sdk` (0.3.263).
- Gemini reader implementation: installed official `@google/gemini-cli` bundle (0.43.0-preview.1).

Earlier Linux checks also exercised interactive restore/backup deletion and normal closure of owned disposable processes for all five application names. No real user application was terminated.

