# Claude Code Install

Switchboard can run as a stdio MCP server behind Claude Code. Full
write-to-config installer support is planned for a later milestone; today the
CLI prints a dry-run snippet you can inspect before adding it to Claude Code.

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

Claude Code can also register the stdio server with its CLI:

```bash
claude mcp add switchboard -- switchboard --cwd /path/to/your/repo mcp
```

After installing, run `/mcp` inside Claude Code to verify the server is listed.

For debugging without the daemon-backed adapter, run
`switchboard --cwd /path/to/your/repo serve`.

Reference: https://code.claude.com/docs/en/mcp
