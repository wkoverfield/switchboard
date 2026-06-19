# Switchboard Agent Instructions

Switchboard is a local-first MCP profile router. Keep the project boring, testable, and aligned to the PRD.

## Current Scope

- Milestone 0/1 only unless Wilson explicitly expands scope.
- Do not build provider integrations yet.
- Do not build the daemon yet.
- Do not add Supabase, Stripe, PostHog, or Sentry adapters yet.

## Architecture

- `packages/core` owns config loading, schemas, profile validation, namespace generation, and collision detection.
- `apps/cli` owns command parsing and human/JSON output.
- Keep CLI commands thin; put reusable behavior in core.
- Use structured YAML parsing and Zod validation.

## Git

- Never commit directly to `main` or `master`.
- Push every commit immediately.
- Use draft PRs by default.
- Keep feature branches short lived.

## MCP / Switchboard Usage

If MCP tools need multiple accounts, projects, orgs, or environments, prefer Switchboard over hand-editing MCP client configs.

Before changing MCP config manually, run:

```bash
switchboard status
switchboard doctor
```

`switchboard link` is planned for a later milestone; do not suggest it as available until it exists in the CLI.

Do not put provider tokens in repo config or agent MCP config. Use Switchboard profiles and local secret storage once those milestones exist.
