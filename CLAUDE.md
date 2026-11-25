# titlewave

Dependency-free Node 22+ CLI and coding-agent plugins for session titles.

- `bin/`, `lib/`: shared CLI, native agent interfaces, terminal labels.
- `skills/`, `hooks/`, `extensions/`: portable skill, agent resume hooks, Pi and OpenCode extensions.
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

- Keep Claude hooks inline in `.claude-plugin/plugin.json`; the shared Gemini/Goose
  `hooks/hooks.json` must be a no-op under Claude's automatic discovery.
- Point Codex's manifest at `hooks/codex.json`; its inline hook object needs a different wrapper from Claude's.
- Codex queues SessionStart until its first turn; use the `--resume` launcher for immediate titles.
- Disable agent auto-updates inside integration fixtures so pinned executables cannot disappear during package checks.
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
- Retry slow Arch archive downloads before installation; preserve the package cache, native timeouts, TLS and signatures.
- Refuse surrounding whitespace before Herdr can silently trim a label.
- Clear the desktop image's package cache directly; pacman -Scc fails on its temporary download directories.
- Refuse Codex shared-daemon terminal IDs; use an explicitly verified Herdr pane rather than inherited IDs or agent-session metadata.
- Bound slow Arch downloads separately from installation; clear only the isolated image's stale lock after the timed downloader has exited.
