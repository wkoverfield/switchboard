# Daemon Lifecycle

Switchboard has a local daemon lifecycle foundation. The daemon currently proves
local process, PID/state, socket management, heartbeat, and daemon-side tool
discovery. `switchboard mcp` can expose daemon-backed tool listings to MCP
clients and route tool calls through the daemon, while `switchboard serve`
remains the daemonless debug and CI fallback.

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
switchboard mcp --mandate <id>
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

`switchboard mcp` serves MCP over stdio, auto-starts the local daemon when
needed, and asks the daemon for namespaced tool metadata and tool-call routing.
Routed calls are audited by the daemon using the same local JSONL audit log
format as `switchboard serve`.

For manual testing, use:

```bash
switchboard --cwd <repo> mcp
```

To run under an active task-scoped mandate, use:

```bash
switchboard --cwd <repo> mcp --mandate fix-ci
```

To keep approval-gated tool calls open while a local decision arrives, add a
bounded wait:

```bash
switchboard --cwd <repo> mcp --mandate fix-ci --approval-wait 30s
```

The adapter validates that the mandate is active for the repo, asks the daemon
to mount only the mandate's profiles, enforces the mandate's allow, deny, and
approval-required namespaced tool patterns before routing calls, and attaches
the mandate id to routed tool-call audit entries. Approval-required tools remain
visible in `tools/list` with `_meta.switchboard.approvalRequired`, but execution
still creates local approval requests that can be listed with
`switchboard approvals` and decided with `switchboard approve <id>` or
`switchboard deny <id>`. Approval gates never expand the allow list: a tool
outside `allowedTools` remains hidden and blocked even if it matches an approval
gate. If the connected MCP client advertises form elicitation support, the
daemon-backed MCP front door can ask for an in-client approve/deny decision,
persist the decision through that same local approval store, and retry approved
tool calls. With `--approval-wait`, the daemon polls for a local CLI decision
for up to the requested duration. If the MCP client disconnects during that
wait, the daemon marks the approval request `stale` so it cannot be approved
after the originating call is gone. This is basic local approval handling, not
provider-specific policy or secret access yet.

Use `switchboard mcp --no-auto-start` to fail fast unless a daemon is already
running.

## Current Limits

- The daemon supports heartbeat, tool discovery, and tool-call routing over its
  local JSON socket.
- `switchboard serve` remains daemonless for debugging and CI. It can enforce
  static mandate policy and honor approved requests loaded at startup, but it
  does not create new approval requests; use `switchboard mcp --mandate <id>`
  for the approval request workflow.
- Mandate-scoped MCP mounts currently validate active mandates, narrow mounted
  profiles, enforce allow/deny/approval-required tool patterns, keep
  approval-required tools discoverable with Switchboard metadata, and annotate
  audit entries.
- Approval handling is local request/decision storage only. The daemon-backed
  MCP adapter can use MCP form elicitation when the connected client advertises
  support, can wait inside a pending tool call when
  `switchboard mcp --approval-wait <duration>` is set, marks waiting requests
  stale when the client disconnects, and marks leftover pending requests for the
  repo stale when the daemon starts. It does not cache upstream sessions,
  enforce provider policy packs, read secrets, or use URL-mode elicitation.
- Approval-required call errors include the pending approval request id and the
  retry commands when no decision arrives during the wait. Approve or deny the
  request, then retry the original tool call.
