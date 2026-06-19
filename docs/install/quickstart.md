# Quickstart

Use this path for the local daemon-backed setup. Provider presets are still a
future milestone.

## 1. Create Starter Config

Preview a starter repo config:

```bash
switchboard init
```

Write `.switchboard.yaml`:

```bash
switchboard init --write
```

The generated profile is a generic stdio MCP profile. Replace
`./path/to/your-mcp-server.mjs` with the command/args for the MCP server you
want Switchboard to route.

## 2. Check The Repo

```bash
switchboard doctor
```

Doctor prints next steps. A ready stdio profile should point you toward:

```bash
switchboard test <profile>
switchboard install codex
switchboard install claude
```

## 3. Test One Profile

```bash
switchboard test local_example
```

This starts the upstream stdio MCP server, lists tools, and writes a local audit
entry.

## 4. Connect A Client

Preview client config:

```bash
switchboard install codex
switchboard install claude
```

Copy the dry-run snippet into the client config you choose, or write
project-scoped config:

```bash
switchboard install codex --write
switchboard install claude --write
```

Every update to an existing client config creates a timestamped backup. Restore
one with:

```bash
switchboard install codex --rollback <backup>
switchboard install claude --rollback <backup>
```

The generated snippets run `switchboard --cwd <repo> mcp`, which auto-starts
the local daemon and routes MCP traffic through it. Use `switchboard serve`
only when you need a daemonless debug or CI fallback.
