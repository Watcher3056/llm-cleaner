# LLM Cleaner

Free up disk space used by **Codex, Claude Code, Cursor, Gemini CLI and Antigravity**—while preserving supported chats' saved context.

## How much space can I save?

Examples from local scans and tests:

- **Codex:** an 88.3 GiB chat store had **64.0 GiB (~72%)** of removable subagent history. This was a scan estimate, not a full-store cleanup.
- **Gemini CLI:** **697.6 MiB (~85%)** of an 823.0 MiB store was removable duplicate journal data; the native loader verified unchanged conversation state.
- **Test copies:** cleanup reclaimed **28.31 MiB across five Cursor chats** and **19.01 MiB across three Antigravity chats**, with retained context verified by their native readers.

Your results will vary. Preview savings before confirming; actual savings are reported afterward. Backups take space too—prefer another drive.

## How does it work?

Long chats accumulate old messages, tool output and duplicate records. Where a supported saved summary exists, the cleaner removes history already covered by it, keeping the summary, recent messages and required references. Gemini cleanup removes superseded journal entries instead.

**Scan → choose an app and action → review → confirm.** Main chats and subagents are separate options. You can also delete chats inactive for **3, 6 or 12 months**, or enable **NTFS compression on Windows**.

## What protects my progress?

- **Saved context stays:** supported history cleanup preserves the summaries and recent context needed to resume. Project files are untouched.
- **Backups come first:** original files are backed up and verified before changes. At the end, choose **Keep**, **Restore** or **Delete backups**.
- **Checks before changes:** the cleaner asks before cleanup, checks for running apps and skips unsupported histories.

Pruning removes old detail from the visible history; deleting an old chat removes that chat. Keep backups until you have reopened your chats and checked them. [See verification and compatibility limits](docs/validation.md).

## Get started

1. [Download ZIP](https://github.com/Watcher3056/llm-cleaner/archive/refs/heads/main.zip) and extract it.
2. Install [Node.js 24 or newer](https://nodejs.org/) if needed.
3. **Windows:** double-click **Start-Windows.cmd**.  
   **Linux / macOS:** run `sh run-cleaner.sh` in the extracted folder.

Use **↑ / ↓** and **Enter**. Save your work before allowing apps to close. Windows and Linux are tested; macOS is not yet verified.

[Detailed guide](docs/guide.md) · [Test results](docs/validation.md) · [Contributing](docs/development.md)
