# Daemon Lifecycle

Switchboard has a local daemon lifecycle foundation. The daemon currently proves
local process, PID/state, socket management, heartbeat, and daemon-side tool
discovery. `switchboard mcp` can expose daemon-backed tool listings to MCP
clients and route tool calls through the daemon, while `switchboard serve`
remains the daemonless debug/installer fallback until daemon auto-start lands.

## Commands

```bash
switchboard daemon status
switchboard daemon start
switchboard daemon ping
switchboard daemon tools
switchboard daemon stop
switchboard mcp
```

For automation:

```bash
switchboard daemon status --json
switchboard daemon start --json
switchboard daemon ping --json
switchboard daemon tools --json
switchboard daemon stop --json
switchboard mcp --runtime-dir <path>
```

## Runtime Files

Switchboard resolves daemon runtime files from:

```text
$SWITCHBOARD_RUNTIME_DIR
$XDG_RUNTIME_DIR/switchboard
/tmp/switchboard-<uid>
```

The runtime directory contains:

```text
daemon.sock
daemon.json
```

`daemon.json` stores the PID, socket path, and start time with private file
permissions. `switchboard daemon stop` removes stale or invalid state.

## Daemon Tool Discovery

`switchboard daemon tools` asks the running daemon to load the active
Switchboard config, start configured stdio upstream profiles, discover their
tools through the shared MCP router, return namespaced tool metadata, and close
the temporary upstream sessions.

The daemon inherits the repo config root from
`switchboard --cwd <repo> daemon start`. This keeps daemon discovery aligned
with `switchboard --cwd <repo> serve` and
`switchboard --cwd <repo> test <profile>`.

## Daemon-Backed MCP Adapter

`switchboard mcp` serves MCP over stdio and asks the running daemon for
namespaced tool metadata and tool-call routing. Routed calls are audited by the
daemon using the same local JSONL audit log format as `switchboard serve`.

The command requires an already-running daemon. For now, use:

```bash
switchboard --cwd <repo> daemon start
switchboard mcp
```

## Current Limits

- The daemon supports heartbeat, tool discovery, and tool-call routing over its
  local JSON socket.
- `switchboard mcp` requires an already-running daemon.
- `switchboard serve` remains daemonless and is still the installer target until
  daemon auto-start lands.
- The daemon does not cache upstream sessions, enforce policy, broker
  approvals, or read secrets yet.
