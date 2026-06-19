# Switchboard Agentic Build Plan

Status: Draft v0.1  
Date: 2026-06-18  
Purpose: Build Switchboard with an autonomous, self-iterating agent loop while preserving quality, testability, architecture, and current documentation alignment.

## Executive Summary

The most effective build model is:

> One lead orchestrator agent owns the product, architecture, integration, quality gates, and final decisions. It spawns bounded worker/research agents for isolated tasks, then reviews, integrates, tests, and iterates.

Do not run many agents loosely in parallel without a single owner. That creates inconsistent architecture, duplicated abstractions, uneven tests, and conflicting assumptions.

The orchestrator should behave like a principal engineer + product owner:
- Reads the PRD.
- Creates milestones.
- Splits work into isolated slices.
- Spawns agents only for bounded tasks.
- Requires tests/docs for each slice.
- Integrates everything itself.
- Runs full verification.
- Opens PRs only when acceptance criteria pass.
- Uses fresh docs for MCP/provider/client APIs before implementation.

Wilson should not need to code or review every detail. Wilson should only be pulled in for product-level decisions that materially change scope, risk, or positioning.

## Source Documents

The lead agent must start by reading:

- `outputs/switchboard-prd.md`
- `outputs/switchboard-distribution-plan.md`
- `outputs/switchboard-agent-discovery-kit.md`
- `outputs/switchboard-agent-research-synthesis.md`
- `outputs/switchboard-competitive-landscape.md`

These are the product source of truth until a repo-level `/docs/product/` folder exists.

## Operating Model

### Lead Agent

Responsibilities:
- Own architecture.
- Maintain milestone plan.
- Decide when to spawn subagents.
- Keep file ownership clean.
- Integrate worker branches/patches.
- Run tests.
- Update docs.
- Keep changelog.
- Create PRs.
- Push every commit.
- Keep the product aligned to the PRD.

The lead agent is allowed to spawn subagents for:
- Current-doc research.
- Provider adapter implementation.
- Client installer implementation.
- Tests/evals.
- Docs/distribution assets.
- Security review.
- UX/onboarding review.

The lead agent should not delegate:
- Final architecture decisions.
- Cross-cutting refactors.
- Release readiness.
- Merging conflicting implementations.
- Product scope decisions.

### Worker Agents

Worker agents get:
- A concrete task.
- Owned files/directories.
- Acceptance criteria.
- Test command expectations.
- Instruction not to touch unrelated files.

Workers must return:
- Summary.
- Files changed.
- Tests run.
- Known gaps.
- Any decisions they made.

### Research Agents

Research agents get:
- A precise question.
- Required sources.
- Expected output format.

They do not edit code.

Use them for up-to-date docs on:
- MCP SDK.
- MCP transports.
- MCP registry metadata.
- Supabase MCP.
- Stripe MCP.
- PostHog MCP.
- Sentry MCP.
- Codex MCP config.
- Claude Code MCP/plugin config.
- Cursor MCP/plugin config.
- VS Code MCP config.
- OS keychain libraries.

## Autonomous Iteration Loop

Every milestone follows this loop:

1. **Read**
   - Read relevant PRD sections.
   - Read existing code.
   - Fetch current docs for touched APIs/frameworks.

2. **Plan**
   - Define concrete acceptance criteria.
   - Identify file ownership.
   - Decide which tasks can be delegated.

3. **Build**
   - Implement the smallest complete vertical slice.
   - Keep abstractions boring.
   - Prefer tested modules over clever CLI glue.

4. **Verify**
   - Unit tests.
   - Integration tests.
   - CLI smoke tests.
   - MCP protocol smoke tests.
   - Lint/typecheck/build.

5. **Evaluate**
   - Run product acceptance scenarios.
   - Compare behavior to PRD.
   - Run `doctor`/onboarding flow if applicable.

6. **Reflect**
   - Write a short milestone note:
     - What worked.
     - What broke.
     - What changed in design.
     - What needs next.

7. **Iterate**
   - Fix failures.
   - Add missing tests.
   - Update docs.
   - Repeat until acceptance criteria pass.

8. **Commit/Push/PR**
   - Commit on feature branch.
   - Push immediately.
   - Open draft PR with checklist.

## Repository Structure

Recommended initial monorepo:

```text
switchboard/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
  AGENTS.md
  llms.txt
  llms-full.txt

  apps/
    cli/
      package.json
      src/
        index.ts
        commands/
        mcp/
        daemon/
        config/
        secrets/
        profiles/
        policy/
        audit/
        install/
        doctor/
        test-profile/
      tests/

  packages/
    core/
      src/
        config/
        profiles/
        namespaces/
        policy/
        audit/
        schemas/
      tests/

    mcp-runtime/
      src/
        stdio-adapter/
        daemon-client/
        upstream/
        tool-registry/
      tests/

    providers/
      src/
        supabase/
        stripe/
        posthog/
        sentry/
        generic/
      tests/

    docs-kit/
      src/
        generate-llms.ts
        validate-registry.ts

  docs/
    agent-recommendation.md
    for-agents.md
    use-cases/
    install/
    security/
    reference/

  examples/
    saas-stack/
    agency-client-work/
    solo-founder-autopilot/
    prod-safe-team/

  fixtures/
    mcp-servers/
    client-configs/

  scripts/
    smoke/
    release/
```

Why this structure:
- Keeps CLI thin.
- Makes core policy/config testable.
- Keeps provider adapters isolated.
- Lets agents work in disjoint directories.
- Makes docs/distribution assets first-class.

## Build Milestones

### Milestone 0: Repo Scaffold

Goal:
- Create a professional open-source TypeScript CLI repo.

Must ship:
- `@switchboard-mcp/cli` package skeleton.
- `switchboard` binary.
- pnpm workspace.
- TypeScript.
- lint/format/test.
- README stub.
- AGENTS.md.
- Initial docs placeholders.
- CI.

Acceptance:
- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `switchboard --help`

Agent delegation:
- Worker 1: package/TS/CLI scaffold.
- Worker 2: docs skeleton and AGENTS/llms placeholders.
- Worker 3: CI/lint/test setup.

### Milestone 1: Config, Profiles, Namespaces

Goal:
- Load and validate global/repo/local config.

Must ship:
- XDG config resolution.
- `.switchboard.yaml`.
- `.switchboard.local.yaml`.
- Precedence rules.
- Profile schema.
- Policy schema stub.
- Namespace generation.
- Slug normalization.
- Collision detection.

Acceptance:
- Unit tests for config precedence.
- Unit tests for namespace generation.
- `switchboard status`.
- `switchboard doctor` basic config checks.

Agent delegation:
- Worker 1: config loader/schema.
- Worker 2: namespace/slug/collision logic.
- Worker 3: tests/fixtures.

### Milestone 2: Generic MCP Mounting

Goal:
- Route tools from generic upstream MCP servers through Switchboard.

Must ship:
- stdio upstream profile support.
- Streamable HTTP upstream profile support if SDK supports it cleanly.
- Tool discovery.
- Namespaced tool exposure.
- Tool call routing.
- Tool schema preservation.
- Basic error handling.

Acceptance:
- Fixture MCP server with two tools.
- Tool list returns namespaced tools.
- Tool call routes to correct upstream.
- Duplicate upstream tool names do not collide.

Agent delegation:
- Research agent: current MCP SDK docs/transports.
- Worker 1: upstream stdio client.
- Worker 2: tool registry/namespace transform.
- Worker 3: integration fixture tests.

### Milestone 3: Stdio Adapter + Local Daemon

Goal:
- Implement hybrid runtime.

Must ship:
- `switchboard mcp` stdio adapter.
- Auto-start local daemon.
- Local socket client.
- Daemon status/start/stop.
- Session ID.
- cwd/workspace capture.
- Version mismatch handling.
- Lock/PID behavior.

Acceptance:
- MCP client fixture can connect via `switchboard mcp`.
- Daemon auto-starts.
- Multiple adapter sessions share daemon state.
- Stale daemon recovery test.

Agent delegation:
- Worker 1: daemon lifecycle/socket.
- Worker 2: stdio adapter.
- Worker 3: session/workspace resolver.
- Worker 4: daemon tests.

### Milestone 4: Audit Logs + Doctor

Goal:
- Make behavior inspectable.

Must ship:
- JSONL audit log.
- Redaction.
- Argument hash.
- Retention/rotation.
- `switchboard logs`.
- `switchboard doctor`.
- Trust checks:
  - no provider tokens in agent configs
  - config permissions
  - `.switchboard.local.yaml` gitignored
  - namespace collisions
  - profile enforcement level

Acceptance:
- Logs show session, profile, environment, tool, mode, result.
- Redaction tests.
- `doctor` gives actionable next commands.

Agent delegation:
- Worker 1: audit logger.
- Worker 2: doctor checks.
- Worker 3: redaction/security tests.

### Milestone 5: Policy Engine + Operating Modes

Goal:
- Support inspect/guarded/autopilot/unrestricted.

Must ship:
- Policy DSL.
- Rule precedence.
- Risk categories.
- Tool visibility filtering.
- Unknown tool handling.
- Enforcement labels: provider/switchboard/advisory.
- Session TTLs.

Acceptance:
- Unit tests for policy precedence.
- Integration tests for each operating mode.
- Unknown tools blocked in read-only profiles.
- Unrestricted mode is explicit/time-bound/logged.

Agent delegation:
- Worker 1: policy engine.
- Worker 2: operating mode/session TTL.
- Worker 3: policy tests.

### Milestone 6: Approval Broker

Goal:
- Support confirmation gates without stdin MCP prompts.

Must ship:
- Pending approval store.
- `switchboard approvals`.
- `switchboard approve <id>`.
- deny/default timeout.
- stale approval invalidation.
- session-scoped allow.

Acceptance:
- Tool call waits for approval.
- Approve proceeds.
- Deny blocks.
- Timeout denies.
- Client disconnect cancels approval.

Agent delegation:
- Worker 1: broker state machine.
- Worker 2: CLI approval commands.
- Worker 3: integration tests.

### Milestone 7: Secrets

Goal:
- Keep provider secrets out of config and agent files.

Must ship:
- macOS keychain support.
- env ref support.
- secret refs in config.
- redaction in errors/logs.
- `switchboard auth <profile>` or provider-specific auth setup command.

Acceptance:
- Keychain happy path on macOS.
- env fallback tests.
- No generated client config contains secrets.

Agent delegation:
- Research agent: best Node keychain library/current docs.
- Worker 1: secret manager.
- Worker 2: auth CLI.
- Worker 3: tests.

### Milestone 8: Client Installers

Goal:
- Install Switchboard into agent clients safely.

Must ship:
- `switchboard install codex --write`.
- `switchboard install claude --write`.
- Dry-run default.
- backups.
- rollback.
- idempotent merge.
- conflict detection.
- docs for Cursor/VS Code even if installer comes later.

Acceptance:
- Fixture config tests.
- Existing switchboard entry updates, not duplicates.
- Conflict diff shown.
- Rollback restores backup.

Agent delegation:
- Research agents for current client config docs.
- Worker 1: Codex installer.
- Worker 2: Claude installer.
- Worker 3: shared install/backup/rollback framework.

### Milestone 9: Guided Onboarding

Goal:
- Install to first successful profile test in under 3 minutes.

Must ship:
- `switchboard init`.
- client detection.
- repo detection.
- existing MCP config detection/import.
- one-provider-first path.
- `switchboard test <profile>`.
- copyable first-agent prompt.

Acceptance:
- Fresh machine simulation.
- Init can skip steps.
- Init writes nothing without confirmation.
- Test verifies auth/tool discovery/routing/audit.

Agent delegation:
- Worker 1: init flow.
- Worker 2: import existing MCP config.
- Worker 3: profile test command.
- UX review agent.

### Milestone 10: Provider Presets

Goal:
- Supabase + Stripe first; PostHog/Sentry by v1.

Must ship MVP:
- Supabase preset.
- Stripe preset.
- read-only enforcement source display.
- provider-specific doctor checks.

Must ship v1:
- PostHog preset.
- Sentry preset.

Acceptance:
- Each provider has docs.
- Each provider has fixture tests/mocked integration tests.
- Doctor accurately labels enforcement.

Agent delegation:
- Research agent per provider.
- Worker per provider adapter.
- Test worker for provider fixtures.

### Milestone 11: Agent Discovery Kit + Distribution Assets

Goal:
- Make Switchboard agent-recommendable.

Must ship:
- README.
- `llms.txt`.
- `llms-full.txt`.
- `AGENTS.md`.
- `/docs/agent-recommendation.md`.
- `/docs/for-agents.md`.
- registry metadata.
- package keywords.
- example templates.
- 90-second demo script.

Acceptance:
- Docs lint.
- Links valid.
- `llms.txt` generated/checked from canonical docs.
- Agent recommendation rules match PRD.

Agent delegation:
- Worker 1: docs pages.
- Worker 2: metadata/registry files.
- Worker 3: examples/templates.
- Review agent: docs consistency.

### Milestone 12: Alpha Hardening

Goal:
- Ship a credible public alpha.

Must pass:
- Full test suite.
- Fresh install smoke.
- Codex install smoke.
- Claude install smoke.
- Generic MCP route smoke.
- Supabase dogfood smoke.
- Stripe mocked/sandbox smoke.
- Security/trust review.
- README quickstart works.
- Known limitations documented.

Exit criteria:
- Wilson can use Switchboard in a real repo.
- At least one other developer can install it without help.
- Public alpha checklist complete.

## Worktree / Branch Strategy

Use one repo with short-lived feature branches:

- `feat/scaffold`
- `feat/config-profiles`
- `feat/generic-mcp-routing`
- `feat/daemon-runtime`
- `feat/audit-doctor`
- `feat/policy-modes`
- `feat/approval-broker`
- `feat/secrets`
- `feat/client-installers`
- `feat/onboarding`
- `feat/provider-supabase`
- `feat/provider-stripe`
- `feat/agent-discovery-kit`

If running multiple agents in parallel, use separate worktrees and disjoint file ownership.

Never let two agents edit the same package unless the lead explicitly coordinates.

## Quality Gates

Every PR must include:

- Tests for new behavior.
- Docs for new user-facing commands.
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- CLI smoke if command-facing.
- Changelog note.

Security-sensitive PRs also require:
- Redaction tests.
- No secrets in fixtures.
- Permission/lock/socket behavior tests if relevant.
- Threat-model note in PR body.

Provider PRs also require:
- Current provider docs checked.
- Mock/fixture test.
- Doctor enforcement-label behavior.
- Known limitations documented.

## Eval Suite

Create `scripts/smoke/` with:

```bash
pnpm smoke:cli-help
pnpm smoke:init-dry-run
pnpm smoke:generic-mcp
pnpm smoke:daemon
pnpm smoke:doctor
pnpm smoke:install-codex-fixture
pnpm smoke:approval
pnpm smoke:audit-redaction
```

Create product eval scenarios:

1. Fresh install -> init -> add generic MCP -> test profile.
2. Existing MCP config -> import -> install Codex -> doctor.
3. Duplicate tool names -> namespace prevents collision.
4. Prod read-only tool call -> blocked.
5. Autopilot dev write -> allowed/logged.
6. Unrestricted session -> explicit TTL/log banner.
7. Approval required -> approve/deny/timeout.
8. Secret accidentally in config -> doctor flags it.

## Documentation Freshness Requirements

Before implementing any integration, the lead or research agent must fetch current docs for:

- MCP SDK/transports.
- Agent client MCP config.
- Provider MCP docs.
- Registry metadata.
- Plugin/skill packaging.

Implementation PR must mention:
- Docs consulted.
- Date consulted.
- Any assumptions.

## Wilson Involvement Model

Wilson does not need to review code.

Wilson should only be pulled in for:
- Name/package change.
- Major scope change.
- Cloud/team monetization decision.
- Security posture change.
- Public launch copy if desired.
- Anything requiring real credentials or paid provider access.

Everything else should be agent-decided using the PRD.

## Recommended First Autonomous Goal

Do not start by building every provider.

Start with:

> Build the Switchboard scaffold through generic MCP routing, doctor, audit, and Codex install, with one fixture upstream MCP server.

This proves the product spine before provider complexity.

First goal acceptance:
- `switchboard --help`
- `switchboard init`
- `switchboard mcp`
- generic fixture upstream mounts
- namespaced tool list
- routed tool call
- audit log
- `doctor`
- Codex fixture installer
- tests pass

Then add Supabase and Stripe.

## Final Recommendation

Use one lead agent as the orchestrator.

Let it spawn workers for bounded slices, but keep architecture, integration, and quality gates centralized.

The winning pattern is:

> Orchestrator owns product truth. Workers own small surfaces. Tests own reality.

