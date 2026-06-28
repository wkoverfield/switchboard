# Harness JSON Contracts

Switchboard's harness-facing JSON surfaces are intentionally small. External
agent harnesses should use them to request scoped authority, launch agents,
preflight the available tool surface, and inspect state afterward.

Switchboard is the local authority and control plane, not the orchestrator. A
harness still decides which task to run, which agent process to spawn, how long
loops continue, and how agents communicate. Switchboard decides which repo,
branch, profiles, tools, approvals, secrets, leases, and audit trail the agent
gets for that task.

## Versioned Contracts

| Surface | Command | Version marker | Contract status |
| --- | --- | --- | --- |
| Provider setup plan | `switchboard add <github-ci\|vercel-preview> --json` | `schemaVersion: "switchboard.provider-add.v1"` | Stable enough for alpha setup automation |
| MCP launch payload | `switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json` | `mcpLaunch.schemaVersion: "switchboard.mcp-launch.v1"` | Stable enough for harness startup |
| Workspace lease payload | `switchboard mandate create ... --json` and `switchboard mandate child ... --json` | `workspaceLease.schemaVersion: "switchboard.workspace-lease.v1"` | Stable enough for harness authority handoff |
| Preset-backed MCP launch payload | `switchboard mandate create --from <github-ci\|vercel-preview> --json` | `mcpLaunch.schemaVersion: "switchboard.mcp-launch.v1"` | Stable enough for harness startup |
| Child MCP launch payload | `switchboard mandate child <task> --parent <id> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json` | `mcpLaunch.schemaVersion: "switchboard.mcp-launch.v1"` | Stable enough for delegated worker startup |
| Mandate status | `switchboard mandate status [id] --json` | `schemaVersion: "switchboard.mandate-status.v1"` | Stable enough for harness polling |
| Mandate renewal | `switchboard mandate renew <id> --lease <duration> --json` | Existing mandate payload | Stable enough for expired-lease recovery |
| Mandate report | `switchboard mandate report <id> --json` | `schemaVersion: "switchboard.mandate-report.v1"` | Stable enough for harness handoff inspection |
| Mandate escalation | `switchboard mandate escalate <id> --json` | `schemaVersion: "switchboard.mandate-escalation.v1"` | Stable enough for local escalation planning |
| Approval requests | `switchboard approvals --mandate <id> --include-children --json` | `schemaVersion: "switchboard.approvals.v1"` | Stable enough for mandate-tree approval visibility |
| Approval watch snapshot | `switchboard approvals --mandate <id> --watch --timeout 0 --json` | `schemaVersion: "switchboard.approvals-watch.v1"` | Stable enough for bounded supervisor polling |
| Tool surface | `switchboard tools --mandate <id> --json` | `schemaVersion: "switchboard.tool-surface.v1"` | Stable enough for harness preflight |
| Audit logs | `switchboard logs --mandate <id> --json` | `schemaVersion: "switchboard.audit-log.v1"` | Stable enough for post-run mandate audit inspection |
| Mandate command errors | `switchboard mandate <create\|child\|status\|handoff\|report\|escalate> ... --json` | `schemaVersion: "switchboard.error.v1"` | Stable enough for harness failure handling |

These contracts are additive within a version: consumers should ignore unknown
fields and should not depend on object key order. Arrays that describe local
work queues, such as mandate escalation `items`, may add new item `type` and
`priority` values within a version; consumers should skip item kinds they do
not understand. A future breaking change should use a new `schemaVersion`.

## Current Payload Roles

`switchboard.provider-add.v1` tells a harness how Switchboard would prepare a
repo for a provider template. It keeps the existing human-friendly shell command
strings and also includes structured `commands` objects. Prefer the structured
objects for automation:

```json
{
  "schemaVersion": "switchboard.provider-add.v1",
  "presetId": "github-ci",
  "profileName": "github_ci",
  "secretRef": "github/example/dev/token",
  "commands": {
    "secrets": [
      {
        "command": "switchboard",
        "args": ["secrets", "set", "github/example/dev/token", "--value-stdin"]
      }
    ],
    "presetCheck": {
      "command": "switchboard",
      "args": ["presets", "check", "github-ci", "--profile", "github_ci"]
    },
    "installs": [
      { "command": "switchboard", "args": ["install", "codex", "--write"] },
      { "command": "switchboard", "args": ["install", "claude", "--write"] }
    ],
    "mandateCreate": {
      "command": "switchboard",
      "args": [
        "mandate",
        "create",
        "fix-ci",
        "--from",
        "github-ci",
        "--profiles",
        "github_ci"
      ]
    }
  }
}
```

`switchboard.mcp-launch.v1` tells a harness how to start a scoped stdio MCP
server and which follow-up commands belong to that authority grant. The payload
includes the mandate id, repo cwd, command, args, `commandCandidates`,
structured `commands`, a `policy` snapshot, runtime launch context, and an
`installHint`. The args include `--cwd <repo> mcp --mandate <id>` so the
launched MCP endpoint stays repo-aware even when the harness runs elsewhere.
Harnesses can keep using top-level `command` and `args` when `switchboard` is
installed on `PATH`, or choose a `commandCandidates` entry such as
`current-entrypoint` for a built package or `source-entrypoint` for a source
checkout.

The launch payload also includes additive fields for control loops:

- `runtimeDir`: the active `SWITCHBOARD_RUNTIME_DIR` when one is already set,
  otherwise `null`
- `env`: non-secret launch environment keys such as `SWITCHBOARD_RUNTIME_DIR`,
  `XDG_STATE_HOME`, and `XDG_CONFIG_HOME` when present
- `approvalWaitMs`: the default MCP approval wait behavior for the launch
- `daemonIsolation`: whether the launch is using an explicit repo runtime dir
  or the default daemon state

The additive `commands` object gives a harness structured invocations for
tool-surface preflight, approval polling across a mandate tree, status, report,
logs, escalation, and a child-mandate template. The additive `policy` object
summarizes mounted profiles, allowed tool patterns, denied tool patterns, and
approval gates so a harness can display the authority grant before launching an
agent without parsing the full persisted mandate.

`switchboard.workspace-lease.v1` wraps the mandate authority into a single
harness-friendly contract. It includes repo path, worktree path, branch,
runtime transport, coarse environment class, profiles, policy summary, lease
timestamps, `mcpLaunch`, `runLaunch`, follow-up commands, capability flags, and
explicit limits. The mandate record remains the local source of truth;
`workspaceLease` is the portable handoff object an orchestrator can pass to a
worker agent.

`runLaunch` is the CLI alternative for harnesses or Code Mode-style agents that
need scoped provider credentials without an MCP client. It points at:

```bash
switchboard --cwd <repo> run --mandate <id> -- <provider command>
```

Run mode scopes mounted profile credentials and audits execution. It is not a
filesystem or network sandbox.

`switchboard.mandate-status.v1` lets a harness poll mandate state. The payload
includes the mandate store path, optional repo filter, and matching mandates
with runtime status, lease, profile, branch, policy, approval gate, and handoff
fields. It also includes an additive `readiness` object with per-mandate and
aggregate `blockers`, `warnings`, and `nextActions`. Current readiness checks
cover expired leases, branch mismatch, worktree mismatch, and missing scoped
`secretRef`s. `switchboard mandate renew <id> --lease <duration> --json`
renews an open mandate from now; child mandates still cannot outlive their
parent mandate's lease.

`switchboard.mandate-report.v1` lets a harness inspect a parent/child mandate
chain at handoff time. The payload includes the selected mandate id, root
mandate id, immutable selected/root mandate UIDs, parent-to-child index,
mandate runtime and handoff counts, related approval requests, and recent audit
entries for mandates in the chain. It also includes an additive `readiness`
object that tells a harness whether the selected mandate can be handed off now,
including open child mandates and pending approval requests that block handoff.
The additive `results` object summarizes completed/blocked/cancelled handoffs,
open mandates, flattened next steps, and artifacts across the reported tree.
The UID fields disambiguate repeated human slug ids such as multiple `fix-ci`
mandates over time.

`switchboard.mandate-escalation.v1` lets a harness build a local escalation
plan from the report data without calling a remote approval service. The payload
includes pending approval decisions, open child mandates, blocked/cancelled
handoffs, missing scoped `secretRef` setup blockers, suggested local commands,
and copy text suitable for a human handoff. Harnesses should treat escalation
`items[].type` and `items[].priority` as extensible and ignore unknown item
kinds.

`switchboard.approvals.v1` lets a harness inspect approval requests for a
single mandate or, with `--include-children`, for the selected mandate's whole
parent/child chain. The payload includes request counts by runtime status,
matching mandates when tree mode is enabled, and `childrenByParent` for UI or
automation. Mandate UIDs prevent reused human ids from mixing old and new
approval queues when available.

`switchboard.approvals-watch.v1` wraps bounded approval queue polling for
supervisor agents. Use `--timeout 0` for one snapshot, or a finite timeout such
as `--timeout 30s`; unbounded JSON watch is rejected so a harness always gets a
complete JSON payload. Because JSON watch buffers snapshots until completion,
bounded JSON watch is capped at `10m`; long-running supervisors should poll with
short windows.

`switchboard.tool-surface.v1` lets a harness inspect the scoped tool surface
before launch. The payload includes profile/tool counts, namespaced tools, and
trusted `_meta.switchboard.approvalRequired` metadata for tools that require a
Switchboard approval gate. Approval metadata does not grant access; allow/deny
policy still controls discovery and execution.

`switchboard.audit-log.v1` lets a harness inspect post-run audit entries. The
payload includes the audit log path, mandate id filter, limit filter, matching
and returned counts, and the returned audit entries. `switchboard logs --json`
keeps top-level `path`, `mandateId`, and `entries` for compatibility.

`switchboard.error.v1` gives harnesses a parseable failure payload for
contracted JSON commands. When a contracted mandate command, approval queue
command, tool-surface command, or audit-log command is run with `--json` and
cannot complete, including parser failures such as a missing required option or
unknown option, Switchboard writes this envelope to stdout and exits non-zero.
Human mode remains unchanged: without `--json`, the same failure is printed as
`error: ...` on stderr. Error payloads include `ok: false`, a stable `code`, a
human-readable `message`, and `nextActions` when Switchboard can suggest a
local recovery command.

MCP runtime failures also include `switchboard.mcp-error.v1` under `mcpError`
while preserving the older `error` and `nextActions` fields. Harnesses should
prefer `mcpError.code` for branch mismatch, expired mandate, missing secret,
denied tool, approval-required, and approval-denied handling.

## Parent/Child Authority Proof

`pnpm smoke:harness-subagent-proof` exercises the intended harness shape with a
fixture MCP server:

```bash
switchboard add github-ci --write --json
switchboard secrets set github/example/dev/token --value-stdin --json
switchboard mandate create --from github-ci --json
switchboard tools --mandate fix-ci --json
switchboard mandate child inspect-ci \
  --parent fix-ci \
  --agent tester \
  --profiles github_ci \
  --branch main \
  --lease 30m \
  --allow-tool github_ci_echo \
  --delegated-by harness-smoke \
  --json
switchboard tools --mandate inspect-ci --json
switchboard mandate report fix-ci --json
```

The parent mandate receives the template policy and an `mcpLaunch` payload. The
child mandate must stay within the parent's repo, branch, profiles, lease, and
tool surface; in the smoke, the child narrows access down to one tool. A harness
can launch a lead agent from the parent `mcpLaunch`, launch a narrower worker
from the child `mcpLaunch`, then inspect `mandate report` for the delegation
chain. Switchboard grants and audits authority; the harness owns the worker
processes and long-running loop.

## Runtime Recovery Proof

`pnpm smoke:mandate-runtime-readiness` exercises the current recovery contract
with a fixture repo:

```bash
switchboard mandate status fix-ci --json
switchboard mandate renew fix-ci --lease 2h --json
switchboard mandate status fix-ci --json
```

The smoke forces an expired mandate and then verifies `mandate status --json`
returns a renew command in `readiness.nextActions`. It also switches the git
worktree to a different branch and verifies the same status payload tells the
harness to switch back to the mandate branch. MCP runtime errors include the
same style of structured `nextActions` for expired mandates, branch mismatch,
and missing scoped secrets.

These checks are runtime awareness, not sandboxing. Switchboard can detect and
deny mismatched local authority before launching or routing tools, but it does
not provision an isolated filesystem, network boundary, or VM.

## Fresh-Agent Eval Proof

The deterministic fresh-agent evals exercise Switchboard from minimal prompts
in isolated fixture repos:

```bash
pnpm eval:fresh-agent-import
pnpm eval:fresh-agent-github-ci
pnpm eval:fresh-agent-expired-mandate
pnpm eval:fresh-agent-subagent
```

Each eval scores whether the simulated fresh agent chose the Switchboard path,
avoided raw secrets, used mandate-scoped MCP/tool-surface commands, recovered
from errors through `nextActions`, and produced a report or handoff surface
where relevant. Redacted transcripts and summaries are written under
`.switchboard-evals/`, which is ignored by git. Live-token provider evals
should remain manual until credentials and network access are intentionally
available.

## Stripe Test Safety Preset

`stripe-test` is the first deliberately visceral safety preset: agents can
inspect Stripe test-mode payments without touching real money. The preset is
guarded, stores a test-mode key behind `secretRef`, allows read/inspection
tools, denies live/prod/admin/payout/transfer/webhook-secret-shaped tools, and
requires approval for test-mode create/update/refund/cancel/capture/confirm
actions. It is a policy/template proof for Stripe test-mode workflows, not a
full Stripe connector or hosted OAuth integration.

## Not Yet Contracted

The following JSON outputs are useful for humans and scripts, but are not yet
formal harness contracts:

| Surface | Command | Current stance |
| --- | --- | --- |
| Daemon diagnostics | `switchboard daemon <status\|start\|ping\|tools\|stop> --json` | Operational surfaces, not mandate authority contracts |

Do not treat unversioned JSON as frozen. Prefer versioned mandate launch,
mandate status, mandate report, mandate escalation, approval request,
tool-surface, and audit-log payloads for harness integration today.

## Compatibility Rules

- Check `schemaVersion` before relying on a versioned payload.
- Ignore unknown fields.
- Treat missing required fields as unsupported.
- For contracted JSON commands, parse stdout as either the success payload or
  `switchboard.error.v1` when the exit code is non-zero.
- Use `--cwd <repo>` when polling or launching for a repo-scoped mandate.
- Keep secrets out of repo config, mandate payloads, and MCP client config.
- Do not assume approval-required metadata means execution will proceed without
  an approval decision.
