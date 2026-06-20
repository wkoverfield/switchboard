# Switchboard Mandate Strategy

Last updated: 2026-06-20

## Thesis

Switchboard should become the local mandate layer for coding agents.

Agents should not simply inherit a human's broad access or a static MCP profile.
They should receive temporary, task-scoped authority tied to the work they are
doing in a specific repo, worktree, branch, and role.

Short positioning:

> Task-scoped authority for agentic software work.

Alternate plain-English positioning:

> Give coding agents bounded jobs without giving them your whole life.

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
or generic permissions wrapper. Its wedge should be repo-native delegated work
authority for coding agents.

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

Provider presets should wait unless they directly support mandate enforcement.

Policy, approvals, and secrets should be designed around mandates rather than
around static profiles alone.

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
- conservative approval-required runtime blocking
- local approval request records
- `switchboard approvals`
- `switchboard approve <id>` / `switchboard deny <id>`
- approved requests honored by daemon-routed mandate calls

This is intentionally still local and thin. It proves the product primitive
without building provider integrations, secret brokerage, or a full approval
broker.

## Next Mandate Slice

Build the smallest approval-gate foundation:

- replace the placeholder `approvalGates` array with typed gate records on
  mandates
- CLI creation syntax for approval-gated namespaced tool patterns
- conservative runtime behavior that blocks approval-required calls until an
  approval exists
- audit entries tied to mandate id, tool name, gate, decision, and reason
- no provider integrations
- no secret broker
- no remote service

Then add in-call wait/poll behavior, richer approval reasons, and any
client-specific elicitation support in follow-up slices.

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
