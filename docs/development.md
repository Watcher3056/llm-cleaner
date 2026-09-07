# Development

Requires Node.js 24 or newer. No npm dependencies.

- `src/` — application code and Windows system helpers
- `tests/` — automated tests using disposable fixtures
- `scripts/` — launcher setup and optional Node.js installation
- `docs/` — detailed guides and validation notes
- Root launchers — simple Windows and Linux/macOS entry points

From the repository root:

```sh
node src/chat-storage.cjs --help
node --test tests/*.cjs
```

Run tests with target applications closed for full mutation-test coverage. Keep real transcripts, generated reports and backups out of commits; these are excluded by .gitignore.

Runtime installation smoke tests (download official Node.js into a disposable temporary folder):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/bootstrap-windows.ps1
```

```sh
python3 tests/bootstrap-posix.py
```

Windows tests supply consent at the prompt-function boundary; POSIX tests send consent through a real pseudo-terminal. Both verify cancellation, download/checksum verification, cleaner launch and runtime reuse. Temporary runtime folders are printed for inspection.
