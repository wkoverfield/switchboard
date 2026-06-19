# Switchboard Roadmap

Last updated: 2026-06-19

This is the working roadmap for Switchboard. The source planning documents live in
`docs/product/source/` and remain the product source of truth when this roadmap is
ambiguous.

## Source Documents

- `docs/product/source/switchboard-prd.md`
- `docs/product/source/switchboard-agentic-build-plan.md`
- `docs/product/source/switchboard-distribution-plan.md`
- `docs/product/source/switchboard-agent-discovery-kit.md`
- `docs/product/source/switchboard-agent-research-synthesis.md`
- `docs/product/source/switchboard-competitive-landscape.md`

## Product North Star

Switchboard is a local-first MCP profile router. It gives developers one local
MCP endpoint while keeping account, project, environment, namespace, policy,
approval, secret, and audit concerns explicit.

Switchboard should win by making multi-account and multi-environment agent tool
use boring:

- one agent config across Codex, Claude Code, Cursor, VS Code, and similar tools
- clear profile namespaces so duplicate tool names are safe
- repo-aware defaults for dev/staging/prod and client-specific profiles
- local-first config and secret handling
- safe progression from `status` to `doctor` to `test` to agent install

## Current State

Implemented on `main` through PR #15:

- TypeScript pnpm workspace
- `@switchboard-mcp/cli`
- `switchboard` binary
- lint, typecheck, test, and CI
- README, AGENTS.md, llms.txt, llms-full.txt placeholders
- XDG global config path
- repo `.switchboard.yaml`
- repo `.switchboard.local.yaml`
- config precedence and diagnostics
- profile schema
- namespace normalization and collision detection
- `switchboard status`
- `switchboard doctor`
- generic stdio upstream profile shape
- fixture upstream MCP server
- upstream tool discovery
- namespaced tool exposure
- routed namespaced tool calls
- `switchboard serve`
- stdio MCP front door
- end-to-end serve-session smoke
- `switchboard test <profile>`
- profile-test smoke from a temp cwd using `--cwd`
- client config dry-run snippets for Codex and Claude Code
- `switchboard install <codex|claude>`
- local JSONL audit log foundation
- `switchboard logs`
- `switchboard init`
- doctor next-step guidance
- daemon runtime path/state helpers
- `switchboard daemon status/start/stop/ping/tools`
- daemon JSON socket protocol
- daemon-side namespaced tool discovery
- `switchboard mcp`
- daemon-backed MCP `tools/list`
- daemon-backed MCP `tools/call`
- daemon-routed tool-call audit logging
- daemon auto-start for `switchboard mcp`
- daemon cwd isolation before MCP attach

Not started:

- policy engine
- approval broker
- secrets/keychain
- provider presets
- guided onboarding
- write-to-config client installers
- Supabase, Stripe, PostHog, or Sentry integrations

## Milestone Status

### Milestone 0: Repo Scaffold

Status: complete.

Acceptance shipped:

- professional TypeScript pnpm workspace
- CLI package
- `switchboard --help`
- lint/typecheck/test scripts
- CI
- README, AGENTS.md, llms files

### Milestone 1: Config, Profiles, Namespaces

Status: complete.

Acceptance shipped:

- XDG global config
- repo and repo-local config
- precedence
- schema validation
- namespace generation
- collision detection
- `status`
- basic `doctor`

### Milestone 2: Generic MCP Mounting

Status: mostly complete, with one deliberate pull-forward.

Acceptance shipped:

- fixture upstream MCP server
- stdio upstream profile shape
- upstream tool discovery
- namespaced tool exposure
- tool call routing
- duplicate tool/collision tests
- `serve` front door
- MCP serve smoke

Pulled forward from Milestone 9:

- `switchboard test <profile>`

Rationale: profile testing is part of the first useful onboarding loop and gives
us a clean quality gate before client installers or provider presets.

Remaining useful hardening:

- optional tool-call probe mode for `switchboard test`
- better error display from upstream stderr
- explicit docs for writing generic stdio profiles

### Milestone 3: Stdio Adapter + Local Daemon

Status: lifecycle foundation in progress.

Original intent:

- agent clients launch a thin stdio adapter
- adapter connects to an auto-started local daemon
- daemon owns upstream sessions, tool cache, policy, approvals, secrets, and audit

Foundation slice:

- daemon runtime path/state helpers
- `switchboard daemon status`
- `switchboard daemon start`
- `switchboard daemon stop`
- `switchboard daemon ping`
- local JSON socket heartbeat
- stale daemon cleanup
- lifecycle smoke test

### Milestone 4: Audit Logs + Doctor

Status: audit foundation complete, doctor guidance in progress.

Original intent:

- local JSONL audit log
- redaction
- better doctor checks
- doctor gives next commands, not just failures

Foundation slice:

- JSONL audit writer in core
- XDG state audit log path
- profile-test audit entries
- routed tool-call audit entries
- `switchboard logs`
- local-only audit docs

Why it matters soon:

Audit is one of the product's trust pillars and becomes harder to retrofit once
policy, approval, and provider-specific behavior exist.

### Milestone 5: Policy Engine + Operating Modes

Status: not started.

Original modes:

- `inspect`
- `guarded`
- `autopilot`
- `unrestricted`

Recommended constraint:

Keep these as config/schema concepts until the daemon/audit layer exists. Avoid
implying enforcement that Switchboard cannot yet provide.

### Milestone 6: Approval Broker

Status: not started.

Original intent:

- daemon-level approval queue
- CLI approval surface
- optional client elicitation later

Do not build before:

- daemon lifecycle
- audit log
- basic policy classification

### Milestone 7: Secrets

Status: not started.

Original intent:

- OS keychain on macOS
- env references as fallback
- no raw provider secrets in repo config or agent config

Do not build provider presets before this has at least a minimal design.

### Milestone 8: Client Installers

Status: not started.

Original intent:

- `switchboard install codex --write`
- `switchboard install claude --write`
- backup/rollback/dry-run
- docs for Cursor and VS Code

Safe near-term slice:

- docs-only Codex/Claude setup using current `switchboard serve`
- dry-run config generation to stdout

Shipped:

- Codex TOML dry-run snippets
- Claude Code JSON dry-run snippets
- validation for client config names/commands
- CI smoke coverage for both snippets

Risk:

Full installers before daemon/secrets may create configs we later need to
migrate.

### Milestone 9: Guided Onboarding

Status: partly pulled forward.

Already shipped:

- `switchboard test <profile>`
- Codex/Claude client config dry-runs
- local audit log viewing

Still needed:

- `switchboard init`
- existing MCP config detection/import
- one-provider-first flow
- dry-run/reversible writes
- final doctor + profile test + copyable agent prompt

### Milestone 10: Provider Presets

Status: not started.

Original order:

- Supabase and Stripe first
- PostHog and Sentry by v1

Gate before starting:

- secrets plan
- provider-specific doctor checks
- clear read/write/default mode policy
- audit story

### Milestone 11: Agent Discovery Kit + Distribution Assets

Status: scaffolded only.

Already present:

- `llms.txt`
- `llms-full.txt`
- agent docs placeholders
- use-case docs placeholders

Still needed:

- real examples
- demo GIF/script
- npm/package metadata polish
- MCP directory listing assets
- agent recommendation docs updated from shipped behavior

### Milestone 12: Alpha Hardening

Status: not started.

Alpha gate:

- fresh install smoke
- Codex install smoke
- Claude install smoke
- dogfood with a real repo
- no raw secrets in generated configs
- at least one non-Wilson developer can install without help

## Recommended Next Sequence

### Completed Slice: Product Docs + Initial Client Config Dry Run

Goal: make the initial daemonless Switchboard path usable from Codex/Claude
before the daemon-backed adapter existed.

Acceptance:

- `docs/install/codex.md` reflected the then-current `switchboard serve`
- `docs/install/claude-code.md` reflected the then-current `switchboard serve`
- one command generates the correct MCP server config
- no provider secrets are written
- tests cover generated config shape

### Completed Slice: Audit Log Foundation

Goal: start the trust layer before policy/provider complexity.

Acceptance:

- local JSONL audit writer in core
- redaction helper
- audit entry for profile test and routed tool call
- docs for local-only audit behavior

### Completed Slice: Doctor + Onboarding Polish

Goal: make the current daemonless path clear for a first-time user before the
daemon exists.

Acceptance:

- `switchboard init` starter config preview/write path
- doctor next-step guidance
- quickstart docs
- smoke coverage for starter config generation

### Completed Slice: Daemon Lifecycle Spike

Goal: prove lifecycle before approvals/secrets.

Acceptance:

- daemon start/status/stop
- local socket
- stale daemon recovery test
- no provider integrations

### Completed Slice: Daemon-Backed MCP List Tools

Goal: let an MCP client connect to a stdio adapter that asks the daemon for
namespaced tool metadata, without forwarding tool calls yet.

Acceptance:

- `switchboard mcp`
- stdio adapter connects to a running daemon socket
- MCP `tools/list` returns daemon-discovered namespaced tool metadata
- smoke covers MCP client -> adapter -> daemon -> fixture upstream discovery
- no MCP tool-call forwarding yet

### Completed Slice: Daemon Tool Call Forwarding

Goal: move routed MCP tool calls through the local daemon.

Acceptance:

- daemon protocol accepts namespaced tool-call requests
- stdio adapter forwards MCP `tools/call` to the daemon
- daemon owns upstream routing for forwarded calls
- daemon-routed calls preserve local audit logging
- existing `serve` behavior remains available for debug/CI
- no daemon auto-start yet

### Completed Slice: Daemon MCP Auto-Start

Goal: make `switchboard mcp` usable as a client entrypoint without requiring a
separate manual daemon start.

Acceptance:

- `switchboard mcp` starts the daemon when it is not running or state is stale
- `switchboard mcp --no-auto-start` preserves fail-fast behavior
- auto-start passes the adapter launch cwd through to the daemon
- MCP smoke covers auto-start, list, call, and audit
- install snippets still remain on `serve` until the next install-switch slice

### Current Slice: Daemon-Backed Install Snippets

Goal: make generated Codex and Claude snippets point at the daemon-backed MCP
adapter now that auto-start is reliable.

Acceptance:

- Codex install dry-run uses `switchboard --cwd <repo> mcp`
- Claude install dry-run uses `switchboard --cwd <repo> mcp`
- install docs use `mcp` as the primary path
- `serve` remains documented as debug/CI fallback
- Codex and Claude install smokes pass

## Rules For Future Agents

- Read `docs/product/roadmap.md` and the relevant source docs before building.
- Use current docs for touched SDKs and client config formats.
- Keep CLI commands thin; reusable behavior belongs in packages.
- Do not add provider integrations before the secrets/policy/audit gates.
- Do not claim enforcement until the code actually enforces it.
- Keep every PR small, reviewed, tested, pushed, and mergeable.
