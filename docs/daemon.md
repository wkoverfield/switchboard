# Daemon Lifecycle

Switchboard has a local daemon lifecycle foundation. The daemon currently proves
local process, PID/state, and socket management; MCP clients still use
`switchboard serve` directly until the adapter-to-daemon routing slice lands.

## Commands

```bash
switchboard daemon status
switchboard daemon start
switchboard daemon ping
switchboard daemon stop
```

For automation:

```bash
switchboard daemon status --json
switchboard daemon start --json
switchboard daemon ping --json
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

## Current Limits

- The daemon exposes only a minimal local JSON socket heartbeat.
- `switchboard serve` does not talk to the daemon yet.
- The daemon does not own upstream MCP sessions, policy, approvals, or secrets
  yet.
