# Codex Install

Switchboard can run as a stdio MCP server behind Codex. The CLI defaults to a
dry-run snippet and can write project-scoped Codex config when you pass
`--write`.

## Dry Run

```bash
switchboard status
switchboard doctor
switchboard install codex
```

The generated snippet targets `~/.codex/config.toml` or project-local
`.codex/config.toml`:

```toml
[mcp_servers."switchboard"]
command = "switchboard"
args = ["--cwd", "/path/to/your/repo", "mcp"]
cwd = "/path/to/your/repo"
startup_timeout_sec = 20
tool_timeout_sec = 60
```

For JSON automation:

```bash
switchboard install codex --json
```

## Write Project Config

Write `.codex/config.toml` for the current repo:

```bash
switchboard install codex --write
```

If `.codex/config.toml` already exists, Switchboard creates a timestamped
backup next to it before writing. Restore one with:

```bash
switchboard install codex --rollback .codex/config.toml.switchboard-backup-<timestamp>
```

Codex also supports registering stdio MCP servers with its CLI:

```bash
codex mcp add switchboard -- switchboard --cwd /path/to/your/repo mcp
```

## User scope: one server for every repo

Instead of a per-repo `.codex/config.toml`, user scope registers a single
Switchboard server in `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`
when `CODEX_HOME` is set). The entry launches with no `--cwd`, so the server
resolves whatever repo Codex is working in per request; one entry serves every
repo.

Preview the exact entry first:

```bash
switchboard install codex --scope user
```

```toml
[mcp_servers."switchboard"]
command = "switchboard"
args = ["mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Write it:

```bash
switchboard install codex --scope user --write
```

If `~/.codex/config.toml` already exists, Switchboard merges the entry and
creates a timestamped backup next to the file, for example
`~/.codex/config.toml.switchboard-backup-<timestamp>`. Unrelated sections such
as `model` or `[projects]` are preserved. Restore a backup with:

```bash
switchboard install codex --scope user --rollback ~/.codex/config.toml.switchboard-backup-<timestamp>
```

Restart Codex after writing or rolling back so it picks up the change.

Alternatively, Codex can register the same server itself:

```bash
codex mcp add switchboard -- switchboard mcp
```

User scope removes the per-repo install, not the per-repo authority: each repo
still needs its own `switchboard init` config and a `switchboard grant` pass
before agents get tools there.

After installing, run `/mcp` inside Codex to verify the server is listed.

For debugging without the daemon-backed adapter, run
`switchboard --cwd /path/to/your/repo serve`.

Reference: https://developers.openai.com/codex/mcp
