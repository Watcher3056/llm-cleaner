# LLM Cleaner

Free up disk space used by **Codex, Claude Code, Cursor, Gemini CLI and Antigravity**.

Review what can be cleaned, choose an action and confirm. Verified backups are created before cleanup.

## Get started

1. [Download ZIP](https://github.com/Watcher3056/llm-cleaner/archive/refs/heads/main.zip) and extract it.
2. Install [Node.js 24 or newer](https://nodejs.org/) if needed.
3. **Windows:** double-click **Start-Windows.cmd**.  
   **Linux / macOS:** open a terminal in the extracted folder and run `sh run-cleaner.sh`.

Use **↑ / ↓** to choose and **Enter** to select. The app guides you through the rest.

## Choose what to clean

- Trim supported chat histories while keeping saved summaries and recent context.
- Clean main chats and subagents separately.
- Delete chats inactive for **3, 6 or 12 months**.
- Optionally enable **NTFS compression on Windows**.

See the space saved after each step. At the end, **keep backups, restore chats or delete backups**.

Save your work before allowing apps to close. Unsupported histories are skipped. Windows and Linux are tested; macOS is not yet verified.

[Detailed guide](docs/guide.md) · [Test results](docs/validation.md) · [Contributing](docs/development.md)
