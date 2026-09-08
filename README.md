# LLM Cleaner
<img width="1672" height="941" alt="image" src="https://github.com/user-attachments/assets/039b0a8a-d3e8-4791-b194-68ca6e560aee" />


### Your AI chats shouldn't eat your SSD.

Long coding sessions leave behind piles of tool output, agent history and duplicate messages. **LLM Cleaner helps you reclaim that space while keeping saved context and recent conversation.**

Works with **Codex · Claude Code · Cursor · Gemini CLI · Antigravity**.

[**Download ZIP**](https://github.com/Watcher3056/llm-cleaner/archive/refs/heads/main.zip) · [How it works](docs/guide.md) · [Compatibility & testing](docs/validation.md)

## How big is the problem?

**88 GiB of Codex chats. 64 GiB identified as reclaimable.**

That's roughly **72%** of one chat store tied up in removable subagent history. Your mileage will vary—the cleaner shows your own estimate before you commit to anything. Backups use space too, so another drive is a good place to keep them.

## Less history. Same place to pick up.

When an app has already summarized older messages, the cleaner trims supported history while keeping the saved summaries, recent messages and required references. It can also remove duplicate journal entries and reclaim unused database space.

Your project files stay untouched. **Verified backups come first**, and the complete cleanup plan needs your confirmation. Finish by keeping your backups, restoring your chats or deleting the backups.

Old details disappear from the chat history after trimming. Keep your backups until you've reopened your chats and checked them. Whole-chat deletion is a separate choice.

## You choose what goes

- Select several apps at once, then configure the whole cleanup in one guided flow.
- Clean **subagents**, **main chats**, or both—with separate batch steps.
- Remove chats inactive for **3, 6 or 12 months**.
- Add **NTFS compression** on Windows for extra savings.
- See the space reclaimed after each step.

## Start cleaning

1. **Download and extract** the ZIP above.
2. **Windows:** double-click `Start-Windows.cmd`.
   **Linux / macOS:** run `sh run-cleaner.sh` in the extracted folder.

If Node.js 24+ is missing or too old, the launcher offers to download and install it for you. Installation requires your approval and leaves your system Node.js unchanged.

Windows and Linux tested. macOS not yet verified. Unsupported histories are skipped.

---

[Detailed guide](docs/guide.md) · [Test results](docs/validation.md) · [Development](docs/development.md)
