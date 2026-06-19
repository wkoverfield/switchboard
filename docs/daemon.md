# Daemon Lifecycle

Switchboard has a local daemon lifecycle foundation. The daemon currently proves
local process, PID/state, socket management, heartbeat, and daemon-side tool
discovery; MCP clients still use `switchboard serve` directly until the
adapter-to-daemon routing slice lands.

## Commands

```bash
switchboard daemon status
switchboard daemon start
switchboard daemon ping
switchboard daemon tools
switchboard daemon stop
```

For automation:

```bash
switchboard daemon status --json
switchboard daemon start --json
switchboard daemon ping --json
switchboard daemon tools --json
switchboard daemon stop --json
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

## Current Limits

- The daemon only supports heartbeat and tool discovery over its local JSON
  socket.
- `switchboard serve` does not talk to the daemon yet.
- The daemon does not route MCP tool calls, cache upstream sessions, enforce
  policy, broker approvals, or read secrets yet.
