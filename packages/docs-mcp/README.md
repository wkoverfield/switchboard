# @switchboard-mcp/docs-mcp

The official MCP server for the Switchboard docs. Point any MCP client at it
and the agent can list, read, and search the same docs a human reads,
including the threat model, quickstart, and roadmap.

## Use

```bash
npx -y @switchboard-mcp/docs-mcp
```

Claude Code:

```bash
claude mcp add switchboard-docs -- npx -y @switchboard-mcp/docs-mcp
```

## Tools

- `list_docs`: every bundled doc with path, title, and description.
- `read_doc`: one doc in full by path (for example `security/threat-model.md`).
- `search_docs`: line-level search across all docs; every query term must
  match.

The docs are bundled into the package at build time, so the server works
offline and needs no configuration, no account, and no network access.

Switchboard itself: [github.com/wkoverfield/switchboard](https://github.com/wkoverfield/switchboard).
