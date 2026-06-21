# Harness JSON Contracts

Switchboard's harness-facing JSON surfaces are intentionally small. External
agent harnesses should use them to request scoped authority, launch agents,
preflight the available tool surface, and inspect state afterward.

## Versioned Contracts

| Surface | Command | Version marker | Contract status |
| --- | --- | --- | --- |
| MCP launch payload | `switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json` | `mcpLaunch.schemaVersion: "switchboard.mcp-launch.v1"` | Stable enough for harness startup |
| Child MCP launch payload | `switchboard mandate child <task> --parent <id> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json` | `mcpLaunch.schemaVersion: "switchboard.mcp-launch.v1"` | Stable enough for delegated worker startup |
| Mandate status | `switchboard mandate status [id] --json` | `schemaVersion: "switchboard.mandate-status.v1"` | Stable enough for harness polling |
| Mandate report | `switchboard mandate report <id> --json` | `schemaVersion: "switchboard.mandate-report.v1"` | Stable enough for harness handoff inspection |
| Approval requests | `switchboard approvals --mandate <id> --include-children --json` | `schemaVersion: "switchboard.approvals.v1"` | Stable enough for mandate-tree approval visibility |
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

`switchboard.mandate-report.v1` lets a harness inspect a parent/child mandate
chain at handoff time. The payload includes the selected mandate id, root
mandate id, immutable selected/root mandate UIDs, parent-to-child index,
mandate runtime and handoff counts, related approval requests, and recent audit
entries for mandates in the chain. It also includes an additive `readiness`
object that tells a harness whether the selected mandate can be handed off now,
including open child mandates and pending approval requests that block handoff.
The UID fields disambiguate repeated human slug ids such as multiple `fix-ci`
mandates over time.

`switchboard.approvals.v1` lets a harness inspect approval requests for a
single mandate or, with `--include-children`, for the selected mandate's whole
parent/child chain. The payload includes request counts by runtime status,
matching mandates when tree mode is enabled, and `childrenByParent` for UI or
automation. Mandate UIDs prevent reused human ids from mixing old and new
approval queues when available.

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
| Audit logs | `switchboard logs --mandate <id> --json` | Useful locally; version before replay/handoff integrations rely on it |
| Daemon diagnostics | `switchboard daemon <status\|start\|ping\|tools\|stop> --json` | Operational surfaces, not mandate authority contracts |

Do not treat unversioned JSON as frozen. Prefer versioned mandate launch,
mandate status, mandate report, approval request, and tool-surface payloads for
harness integration today.

## Compatibility Rules

- Check `schemaVersion` before relying on a versioned payload.
- Ignore unknown fields.
- Treat missing required fields as unsupported.
- Use `--cwd <repo>` when polling or launching for a repo-scoped mandate.
- Keep secrets out of repo config, mandate payloads, and MCP client config.
- Do not assume approval-required metadata means execution will proceed without
  an approval decision.
