# Claude Code Install

Switchboard can run as a stdio MCP server behind Claude Code. The CLI defaults
to a dry-run snippet and can write project-scoped Claude Code config when you
pass `--write`.

## Dry Run

```bash
switchboard status
switchboard doctor
switchboard install claude
```

The generated snippet uses Claude Code's `mcpServers` JSON shape:

```json
{
  "mcpServers": {
    "switchboard": {
      "command": "switchboard",
      "args": ["--cwd", "/path/to/your/repo", "mcp"],
      "env": {}
    }
  }
}
```

Use project scope when the Switchboard repo config should travel with the
project, or local/user scope when it should stay machine-specific.

## Write Project Config

Write `.mcp.json` for the current repo:

```bash
switchboard install claude --write
```

If `.mcp.json` already exists, Switchboard creates a timestamped backup next to
it before writing. Restore one with:

```bash
switchboard install claude --rollback .mcp.json.switchboard-backup-<timestamp>
```

Claude Code can also register the stdio server with its CLI:

```bash
claude mcp add switchboard -- switchboard --cwd /path/to/your/repo mcp
```

After installing, run `/mcp` inside Claude Code to verify the server is listed.

For debugging without the daemon-backed adapter, run
`switchboard --cwd /path/to/your/repo serve`.

Reference: https://code.claude.com/docs/en/mcp
