# Switchboard Agent Instructions

Switchboard enters through local-first, repo-aware MCP setup and deepens into
the local mandate layer for coding agents. Keep the project boring, testable,
and aligned to the current roadmap in `docs/product/roadmap.md`.

## Current Scope

- The daemon/profile/install/audit foundation is mandate substrate; do not throw
  it away.
- Simple users should get value from project-scoped MCP/environment setup
  without understanding mandates.
- Product direction now uses mandates as the deeper power layer: task, repo,
  worktree, branch, agent role, profiles, allowed/denied tools, lease, approval
  gates, audit, and handoff state.
- Long-term mandate work should support controlled delegation: parent mandates,
  narrower child mandates, approval escalation, and audit-preserved delegation
  chains.
- Switchboard is not a full agent orchestrator. External harnesses assign work
  and spawn agents; Switchboard grants scoped repo/profile/tool authority.
- Keep mandate features scriptable and JSON-friendly for harness integration.
- Prefer mandate/policy/audit/approval depth over broad provider preset work.
- Do not build provider integrations yet.
- Do not add Supabase, Stripe, PostHog, or Sentry adapters yet.
- Do not build a secrets broker, remote service, or full approval broker unless
  the current roadmap slice explicitly calls for it.

## Architecture

- `packages/core` owns config loading, schemas, profile validation, namespace
  generation, collision detection, audit helpers, and mandate persistence/policy
  primitives.
- `packages/mcp-runtime` owns generic MCP mounting, namespaced routing, and MCP
  runtime enforcement hooks.
- `apps/cli` owns command parsing, human/JSON output, daemon protocol/runtime
  wiring, and client install surfaces.
- Keep CLI commands thin; put reusable behavior in core.
- Use structured YAML parsing and Zod validation.

## Git

- Never commit directly to `main` or `master`.
- Push every commit immediately.
- Use draft PRs by default.
- Keep feature branches short lived.

## MCP / Switchboard Usage

If MCP tools need multiple accounts, projects, orgs, environments, or
task-scoped agent authority, prefer Switchboard over hand-editing MCP client
configs.

Before changing MCP config manually, run:

```bash
switchboard status
switchboard doctor
switchboard mandate status
```

`switchboard link` is planned for a later milestone; do not suggest it as available until it exists in the CLI.

Do not put provider tokens in repo config or agent MCP config. Use Switchboard profiles and local secret storage once those milestones exist.
