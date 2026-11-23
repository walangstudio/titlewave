# titlewave

Dependency-free Node 22+ CLI and coding-agent plugins for session titles.

- `bin/`, `lib/`: shared CLI, native agent interfaces, terminal labels.
- `skills/`, `hooks/`, `extensions/`: portable skill, Claude context, Pi extension.
- `test/`: unit checks, real-agent fixtures, terminal and package checks.

## The loop

```bash
npm run build
npm test
docker build -f test/Dockerfile -t titlewave-test .
docker run --rm --init titlewave-test
```

Only list agent and terminal versions after real-binary checks pass. Never
inject keystrokes or claim a storage update repainted a running header. Pi and
Gemini file-based renames require an explicitly closed session.

Before committing the marketplace package, run
`python ../walangstudio-marketplace/scripts/sync_titlewave.py .` and compare the
generated files with this source. Publish the source repository before the
marketplace entry that points at it.

## Failure log

- Keep Claude hooks inline in `.claude-plugin/plugin.json`; Gemini executes
  `hooks/hooks.json`.
- Wait for Konsole's window to map before sending its first title.
- Preinstall OpenCode's pinned plugin SDK in the integration image and preserve
  relative symlinks when copying it into a fixture.
- Windows npm `.cmd` shims cannot be executed safely with arbitrary names.
  Require native `.exe` CLIs instead of passing user input through `cmd /c`.
- Keep Zellij's stdout on its PTY during startup. Redirecting it prevents the
  headless integration session from initializing.
- Gemini's extension listing uses stderr; capture both streams when checking it.
- Shell scripts must have LF endings when Docker copies the working tree.
- Rename Herdr's single-pane tab too; changing a pane label leaves the tab unchanged.
- Allow 60 seconds for cold desktop-terminal startup in headless checks.
