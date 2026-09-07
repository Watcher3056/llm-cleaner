# Development

Requires Node.js 24 or newer. No npm dependencies.

- `src/` — application code and Windows system helpers
- `tests/` — automated tests using disposable fixtures
- `scripts/` — Windows launcher setup
- `docs/` — detailed guides and validation notes
- Root launchers — simple Windows and Linux/macOS entry points

From the repository root:

```sh
node src/chat-storage.cjs --help
node --test tests/*.cjs
```

Run tests with target applications closed for full mutation-test coverage. Keep real transcripts, generated reports and backups out of commits; these are excluded by .gitignore.
