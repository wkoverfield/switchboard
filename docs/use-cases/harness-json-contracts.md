# Harness JSON Contracts

Switchboard's harness-facing JSON surfaces are intentionally small. External
agent harnesses should use them to request scoped authority, launch agents,
preflight the available tool surface, and inspect state afterward.

## Versioned Contracts

| Surface | Command | Version marker | Contract status |
| --- | --- | --- | --- |
| MCP launch payload | `switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json` | `mcpLaunch.schemaVersion: "switchboard.mcp-launch.v1"` | Stable enough for harness startup |
| Mandate status | `switchboard mandate status [id] --json` | `schemaVersion: "switchboard.mandate-status.v1"` | Stable enough for harness polling |
| Tool surface | `switchboard tools --mandate <id> --json` | `schemaVersion: "switchboard.tool-surface.v1"` | Stable enough for harness preflight |

These contracts are additive within a version: consumers should ignore unknown
fields and should not depend on object key order. A future breaking change should
use a new `schemaVersion`.

## Current Payload Roles

`switchboard.mcp-launch.v1` tells a harness how to start a scoped stdio MCP
server. The payload includes the mandate id, repo cwd, command, and args. The
args include `--cwd <repo> mcp --mandate <id>` so the launched MCP endpoint
stays repo-aware even when the harness runs elsewhere.

`switchboard.mandate-status.v1` lets a harness poll mandate state. The payload
includes the mandate store path, optional repo filter, and matching mandates
with runtime status, lease, profile, branch, policy, approval gate, and handoff
fields.

`switchboard.tool-surface.v1` lets a harness inspect the scoped tool surface
before launch. The payload includes profile/tool counts, namespaced tools, and
trusted `_meta.switchboard.approvalRequired` metadata for tools that require a
Switchboard approval gate. Approval metadata does not grant access; allow/deny
policy still controls discovery and execution.

## Not Yet Contracted

The following JSON outputs are useful for humans and scripts, but are not yet
formal harness contracts:

| Surface | Command | Current stance |
| --- | --- | --- |
| Approval request list | `switchboard approvals --json` | Useful locally; version when external harnesses need approval queues |
| Audit logs | `switchboard logs --mandate <id> --json` | Useful locally; version before replay/handoff integrations rely on it |
| Daemon diagnostics | `switchboard daemon <status\|start\|ping\|tools\|stop> --json` | Operational surfaces, not mandate authority contracts |

Do not treat unversioned JSON as frozen. Prefer versioned mandate launch,
mandate status, and tool-surface payloads for harness integration today.

## Compatibility Rules

- Check `schemaVersion` before relying on a versioned payload.
- Ignore unknown fields.
- Treat missing required fields as unsupported.
- Use `--cwd <repo>` when polling or launching for a repo-scoped mandate.
- Keep secrets out of repo config, mandate payloads, and MCP client config.
- Do not assume approval-required metadata means execution will proceed without
  an approval decision.
