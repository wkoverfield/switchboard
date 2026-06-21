# Switchboard Mandate Strategy

Last updated: 2026-06-20

## Thesis

Switchboard should enter through repo-aware MCP/environment setup and deepen
into the local mandate layer for coding agents.

For normal developers, the clearest first pain is still project-scoped agent
tooling: Codex, Claude Code, Cursor, VS Code, and other clients should get the
right MCP profiles for the current repo and environment without duplicated
config or accidental dev/prod/account mixups. Codex and Claude Code are shipped
installer targets today; Cursor and VS Code remain planned surfaces.

For advanced agentic workflows, agents should not simply inherit a human's broad
access or a static MCP profile. They should receive temporary, task-scoped
authority tied to the work they are doing in a specific repo, worktree, branch,
and role.

Positioning bridge:

> Switchboard gives coding agents the right tools for each repo, environment,
> and task.

Short positioning:

> Task-scoped authority for agentic software work.

Alternate plain-English positioning:

> Give coding agents bounded jobs without giving them your whole life.

Harness positioning:

> Bring your own agent harness. Switchboard gives each agent the right tools,
> scope, lease, and audit trail.

## Why Adjust

Generic MCP gateway/profile routing is becoming crowded. That does not make the
current Switchboard foundation wrong; it means the foundation should serve a
sharper product primitive.

The current CLI, daemon, audit log, profile routing, install, and doctor work is
the substrate for mandates:

- the daemon is where mandate-aware policy and approvals can run
- the audit log is where mandate-scoped actions become inspectable
- client installers make the same local authority layer usable from Codex,
  Claude Code, and later Cursor/VS Code
- profile routing gives mandates concrete tool surfaces to allow or deny
- doctor/onboarding can explain what authority a repo is ready to delegate

## Competitive Read

The market is splitting into adjacent lanes:

- MCP gateways/catalogs manage servers, policy, audit, and integrations.
  Examples include Obot and Docker MCP.
- Agent auth/action platforms manage app authorization, tool execution, and
  governance. Arcade is a clear example.
- Human approval/orchestration frameworks manage pauses, approvals, and agent
  workflows. HumanLayer is a clear example.
- Coding-agent clients already have their own permissions, sandboxing, and MCP
  config surfaces.

Switchboard should avoid being only another MCP gateway, connector marketplace,
or generic permissions wrapper. Its wedge should be repo-native setup plus
delegated work authority for coding agents.

Useful reference links:

- Obot MCP Gateway: https://obot.ai/
- Docker MCP Catalog and Toolkit:
  https://www.docker.com/products/mcp-catalog-and-toolkit/
- Arcade MCP runtime / agent authorization: https://www.arcade.dev/
- HumanLayer coding-agent workflows: https://www.humanlayer.dev/

## Core Primitive

```text
mandate =
  task
  + repo
  + worktree
  + branch
  + agent role
  + MCP profiles
  + allowed tools
  + denied tools
  + lease / expiry
  + approval gates
  + audit trail
  + handoff state
```

Mandates should answer:

- What is this agent allowed to work on?
- In which repo/worktree/branch?
- Which profile/tool surfaces are available?
- Which actions are denied outright?
- Which actions need approval?
- When does this authority expire?
- What did the agent actually do under this mandate?
- Can another agent or human safely resume the work?

## Product Layers

Layer 1 is easy repo-aware MCP/environment setup:

- project-scoped agent config, with Codex and Claude Code shipped first
- correct accounts/projects for each repo
- dev/prod separation
- fewer duplicate MCP configs
- safer defaults
- basic local auditability

Layer 2 is task-scoped mandates:

- active mandate context selects profiles and policy
- runtime tool calls know the mandate id
- audit entries include mandate id when active
- leases and approval gates become task-specific

Layer 3 is controlled delegation:

- a lead agent can create child mandates for worker agents
- child mandates cannot exceed the parent's repo, profile, tool, lease, or
  approval-gate constraints
- privileged actions escalate back to Wilson or the parent approver
- audit logs preserve the delegation chain

Layer 4 is harness integration:

- external orchestrators request scoped authority from Switchboard
- Switchboard returns a JSON MCP command/args payload
- the harness launches agents through that scoped endpoint
- the harness inspects mandate-scoped logs afterward

Mandates should be powerful but optional. A developer should be able to get
value from Switchboard as a repo-aware MCP setup tool before learning the
mandate model.

These layers describe product depth, not implementation order. Active mandates,
child mandates, and the first harness JSON contracts now exist locally; the next
build work should deepen approval visibility and enforcement without turning
Switchboard into the orchestrator.

## Harness Boundary

Switchboard should coexist with agent harnesses rather than replace them.

Harnesses decide:

- what work gets assigned
- what agents to spawn
- when to retry or escalate
- how agents communicate

Switchboard decides:

- what repo/worktree/branch context an agent receives
- which MCP profiles and tools it can use
- which tools are denied
- how long authority lasts
- when approval is required
- how actions are audited
- eventually, once child mandates exist, how delegation chains are preserved

Important scriptable surfaces:

- `switchboard mandate create --json`
- `switchboard mandate status --json`
- `switchboard mcp --mandate <id>`
- `switchboard tools --mandate <id> --json`
- `switchboard approvals --mandate <id> --include-children --json`
- `switchboard logs --mandate <id> --json`
- `switchboard mandate child --parent <id> --json`
- future lease and approval escalation commands with JSON output

## Example Mandates

Implementer:

> This implementer agent may fix CI on PR #214, inspect GitHub checks and
> Vercel logs, edit files, and push to this branch for 2 hours, but cannot
> deploy prod or access secrets.

Reviewer:

> This reviewer agent may read the diff and comment on GitHub, but cannot modify
> files.

Release:

> This release agent may deploy preview automatically, but prod requires Wilson
> approval.

## Product Implications

Provider presets should wait unless they directly support mandate safety or the
repo-aware setup wedge.

Policy, approvals, and secrets should be designed around mandates rather than
around static profiles alone. Simple profile-only usage must remain supported
for users who do not need task-scoped authority yet.

Installers and MCP routing remain useful, but they are distribution and runtime
plumbing. They are not the durable product differentiation by themselves.

## Shipped Foundation

Switchboard now has the first local mandate foundation:

- `switchboard mandate create`
- local mandate schema and persistence
- repo, worktree, branch, agent role, profile list, and lease binding
- `switchboard mandate status`
- `switchboard mcp --mandate`
- `switchboard serve --mandate`
- `switchboard logs --mandate`
- mandate-linked MCP tool-call audit entries
- allowed and denied namespaced tool patterns
- policy-filtered tool listing under an active mandate
- pre-discovery denial for disallowed daemon-routed tool calls
- approval-required tool patterns
- approval gate reason metadata
- conservative approval-required runtime blocking
- local approval request records
- `switchboard approvals`
- `switchboard approve <id>` / `switchboard deny <id>`
- approved requests honored by daemon-routed mandate calls
- optional bounded approval waits
- stale approval semantics for disconnected approval waits
- daemon-start invalidation for leftover pending approval requests
- `switchboard mandate create --json` returns an MCP launch payload for external
  harnesses
- approval gates carry optional risk classes and structured labels
- daemon-backed MCP can use form-mode elicitation for approval decisions when
  the connected client advertises support, while preserving CLI fallback
- approval-required tools remain discoverable with
  `_meta.switchboard.approvalRequired` while execution stays gated
- approval gates narrow the allowed tool surface; they never grant access to
  disallowed or denied tools

This is intentionally still local and thin. It proves the product primitive
without building provider integrations, secret brokerage, or a full approval
broker.

## Harness Surface

Active mandate use is now easier for external harnesses without making
Switchboard the orchestrator:

- `switchboard mandate create --json` returns stable mandate data and a
  scoped MCP command/args payload
- the launch payload includes a schema/version marker, mandate id, repo cwd,
  command, and args
- launch args carry `--cwd <repo> mcp --mandate <id>`
- launch payloads include additive `commandCandidates` so harnesses can use
  the PATH binary in normal installs, the built Node entrypoint, or the source
  checkout `tsx` entrypoint when dogfooding
- `switchboard mandate status --json` exposes versioned mandate state with
  `switchboard.mandate-status.v1`
- `switchboard mandate child --parent <id>` creates narrower child mandates
  from active parents
- `switchboard mandate handoff <id>` closes mandate authority with a handoff
  summary
- `switchboard mandate report <id> --json` exposes versioned parent/child
  handoff reports with readiness blockers, result rollups, related approval
  requests, and audit entries
- `switchboard mandate escalate <id> --json` exposes a local escalation plan
  with pending approvals, open child mandates, blocked/cancelled handoffs,
  suggested commands, and copy text
- `switchboard approvals --mandate <id> --include-children --json` exposes a
  versioned approval queue across a parent/child mandate tree
- `switchboard tools --mandate <id> --json` exposes the scoped tool surface for
  harness preflight and UI without launching an agent client
- the tool surface payload is explicitly versioned as
  `switchboard.tool-surface.v1`
- contracted mandate command failures under `--json` return a versioned
  `switchboard.error.v1` envelope on stdout with a non-zero exit code
- `docs/use-cases/harness-json-contracts.md` documents the current versioned
  JSON contracts and the unversioned surfaces that should stay provisional
- `docs/use-cases/harness-scoped-mandates.md` documents the "request scoped
  authority, launch agent, inspect logs" flow

## Next Mandate Slice

Recommended follow-up:

- clarify inherited approval-gate override UX for child mandates
- extend `switchboard.error.v1` to additional non-mandate JSON surfaces when
  they become harness-facing contracts
- harden the approval elicitation and gated-tool metadata client matrix with
  real Codex/Claude smoke notes
- no provider presets
- no secret broker
- no remote service
- no full agent orchestrator

Child mandates now persist:

- `parentMandateId`
- `delegatedBy`
- `delegationPath`
- `maxLeaseExpiresAt`
- narrowed profile and tool scopes
- inherited or stricter approval gates
- handoff state, summary, next steps, artifacts, actor, and timestamp

Child mandates must not exceed parent repo, worktree, branch, profile, tool,
or lease scope. Approval gates are inherited and may be made stricter, but they
do not grant access beyond the parent's allowed tool scope. Handoff reporting
closes runtime authority and preserves the delegation chain for harnesses.
Future work should improve approval escalation and result aggregation, not turn
Switchboard into the agent orchestrator.

## Original First Mandate Slice

Build the smallest local foundation:

- `switchboard mandate create`
- local mandate schema and persistence
- bind mandate to repo, worktree, branch, agent role, profile list, and lease
- `switchboard mandate status`
- audit entries include optional mandate id
- no provider integrations
- no secret broker
- no full policy enforcement yet

The first slice should prove that Switchboard can name, persist, inspect, and
audit task-scoped authority before trying to enforce every possible permission.

Demo shape:

```bash
switchboard mandate create fix-ci \
  --agent implementer \
  --profiles github_findu,vercel_preview \
  --branch fix/ci \
  --lease 2h \
  --allow-tool 'github_findu_*' \
  --deny-tool '*_deploy_prod'

switchboard mandate status
switchboard logs --mandate fix-ci
```
