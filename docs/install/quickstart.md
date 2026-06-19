# Quickstart

Use this path for a daemonless local setup while the daemon and provider
presets are still future milestones.

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

Switchboard does not write Codex or Claude config files yet. Copy the dry-run
snippet into the client config you choose.
