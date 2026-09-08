# Validation — 2026-09-08

Tests use disposable copies. Real Windows chat storage was not cleaned or altered.

## Final automated suite

- Ubuntu WSL2, native Linux filesystem, Node.js 24.12: 49 passed, zero failures or skips.
- Windows: 47 passed, zero failures, two skipped because target user applications were running.
- Covers summaries/tails, dependency protection, unknown formats, batch selection, one combined preview/confirmation, multi-application cleanup, age deletion, catalogue updates, exported transcripts, nonempty SQLite WAL, exact backup restoration, changed-file refusal, arrow menus, default cancellation and process closure.

## Cursor

Inspected installed Windows 3.10.20 storage and implementation. Native Linux Cursor 3.19.13 loaded five real copied chats, including two modern serialized-agent-state chats, before and after cleanup. All five loaded message/summary maps were deeply equal; no corrupted checkpoint flags. Serialized agent state stayed byte-for-byte identical. Source reduction in this sample: 29,687,808 bytes (28.31 MiB). Repeat pruning found no further candidates. Backups restored the exact original database bytes.

A selected real chat was deleted from an isolated database. Native Cursor no longer loaded it; all four sibling chats still loaded. After restoration, native Cursor loaded all five chats again. Deletion also has catalogue/export and exact-restore tests.

This checks the application's native renderer/composer loader. The disposable application had no account credentials; signed-in chat interaction, model replies and shared remote agent-state retrieval were not tested. A test-only hook exposed the native service in the copied Linux bundle; parsing code was not replaced.

## Antigravity

Native Linux language server 1.21.9 loaded all steps of three real pruned trajectories, including pagination, and exported them to Markdown. Every retained native step was deeply equal; covered payloads became native DUMMY steps at the same positions. All incremental summaries and the remaining tail survived. Source reduction: 19,934,329 bytes (19.01 MiB). Restore reproduced exact original encrypted bytes.

Native deletion verification confirmed the selected trajectory disappeared, siblings remained readable, and restoration returned an identical native trajectory. Unit tests additionally verify both recognized UI catalogue formats. The full Antigravity graphical UI and a model continuation were not tested.

## Other applications

Previous native Linux verification in this workspace: Codex CLI 0.145.0 and Claude CLI 2.1.187 each completed 15 resume executions using deterministic local API responses, not paid remote models. Gemini CLI 0.43.0-preview.1 loaded all 11 reducible local sessions with identical replayed state; native recorder resume/append/reload was checked on two copied sessions. These native experiments were not all repeated in this final packaging pass; the final cross-platform automated suite was rerun.

The final arrow-menu workflow was also exercised in a real Linux pseudo-terminal: select Cursor main pruning, confirm, select Antigravity main pruning, confirm, finish and restore both. Both stages reported positive savings and every source file returned to its exact original hash. An initial harness attempt correctly stopped at the application-closure prompt while a disposable Cursor process was still exiting; the successful rerun began with the application closed. Interactive backup deletion was previously exercised in Linux. Native NTFS compression was exercised on a disposable Windows file with identical before/after content hashes. Native macOS has not been tested.

## Scope

Results establish compatibility with the inspected layouts and sampled native readers, not every past/future application version. Unknown layouts and unresolved dependencies are retained. Cursor's shared blobs/serialized agent state and Antigravity's metadata/brain artifacts remain intentionally. Savings shown above are measured on samples, not estimates for the entire user's installation.

## Optional Node.js installation

Windows x64 and Linux x64 smoke tests downloaded the official Node.js 24.20.0 runtime into isolated temporary folders, verified its checksum, launched the cleaner and reused the runtime without another prompt. Cancellation created no installation files. The Linux pseudo-terminal test also checked that Enter declines and redirected input cannot authorize installation. Windows supplied consent through a test replacement of the prompt function. Existing system Node.js detection was checked under Windows PowerShell 5.1. macOS and ARM64 installers have not been exercised on native hardware.
