# Codex Install

Switchboard can run as a stdio MCP server behind Codex. Full write-to-config
installer support is planned for a later milestone; today the CLI prints a
dry-run snippet you can inspect before adding it to Codex.

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

Codex also supports registering stdio MCP servers with its CLI:

```bash
codex mcp add switchboard -- switchboard --cwd /path/to/your/repo mcp
```

After installing, run `/mcp` inside Codex to verify the server is listed.

For debugging without the daemon-backed adapter, run
`switchboard --cwd /path/to/your/repo serve`.

Reference: https://developers.openai.com/codex/mcp
