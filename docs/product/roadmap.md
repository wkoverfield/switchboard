# Switchboard Roadmap

Last updated: 2026-06-19

This is the working roadmap for Switchboard. The source planning documents live in
`docs/product/source/` and remain the product source of truth when this roadmap is
ambiguous, except where the mandate strategy explicitly supersedes the earlier
profile-router framing.

## Source Documents

- `docs/product/source/switchboard-prd.md`
- `docs/product/source/switchboard-agentic-build-plan.md`
- `docs/product/source/switchboard-distribution-plan.md`
- `docs/product/source/switchboard-agent-discovery-kit.md`
- `docs/product/source/switchboard-agent-research-synthesis.md`
- `docs/product/source/switchboard-competitive-landscape.md`
- `docs/product/mandate-strategy.md`

## Product North Star

Switchboard is the local mandate layer for coding agents. It gives agents
temporary, task-scoped authority for a specific repo, worktree, branch, role,
profile set, tool surface, lease, approval posture, and audit trail.

The earlier local-first MCP profile router work remains the substrate. It gives
mandates a durable runtime across Codex, Claude Code, Cursor, VS Code, and
custom harnesses.

Switchboard should win by making delegated coding-agent work bounded:

- one local mandate-aware MCP endpoint across coding-agent clients
- repo/worktree/branch-aware authority, not broad inherited human access
- leases and expiry for agent access
- allowed/denied tool surfaces tied to task and role
- approval gates for sensitive actions
- audit and handoff state scoped to each mandate
- clear profile namespaces so duplicate tool names are safe
- local-first config, secrets, and policy enforcement

## Current State

Implemented on `main` through PR #23, plus the current mandate-runtime-context branch:

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
- daemon-backed Codex/Claude install snippets
- project-scoped Codex/Claude install writes with backups and rollback
- project Codex/Claude client config detection in `switchboard doctor`
- existing project MCP server name discovery in `switchboard doctor`
- mandate strategy and roadmap pivot toward task-scoped authority
- local mandate schema and persistence
- `switchboard mandate create`
- repo/worktree/branch/agent/profile/lease binding for mandates
- `switchboard mandate status`
- optional audit log mandate ids
- `switchboard logs --mandate`
- `switchboard mcp --mandate`
- `switchboard serve --mandate`
- mandate-scoped MCP profile mounting
- mandate-linked MCP tool-call audit entries

Not started:

- mandate-aware tool-level policy enforcement
- policy engine
- approval broker
- secrets/keychain
- provider presets
- guided onboarding
- global/user-scope client installers
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

Status: not started; should be mandate-aware.

Original modes:

- `inspect`
- `guarded`
- `autopilot`
- `unrestricted`

Recommended constraint:

Keep these as config/schema concepts until the daemon/audit layer exists. Avoid
implying enforcement that Switchboard cannot yet provide.

Policy rules should be evaluated in the context of a mandate, not only a static
profile. Profile-level policy remains useful, but task/repo/worktree/branch/role
context is the differentiator.

### Milestone 6: Approval Broker

Status: not started; should be mandate-aware.

Original intent:

- daemon-level approval queue
- CLI approval surface
- optional client elicitation later
- approval requests tied to mandate id, task, repo, branch, agent role, and tool

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

Secrets should be granted to agents through a mandate lease where possible, not
through permanent inherited profile access.

### Milestone 8: Client Installers

Status: partly pulled forward.

Original intent:

- `switchboard install codex --write`
- `switchboard install claude --write`
- backup/rollback/dry-run
- docs for Cursor and VS Code

Safe near-term slice:

- docs-only Codex/Claude setup using current daemon-backed `switchboard mcp`
- dry-run config generation to stdout
- project-scoped Codex/Claude writes with backups and rollback

Shipped:

- Codex TOML dry-run snippets for `switchboard --cwd <repo> mcp`
- Claude Code JSON dry-run snippets for `switchboard --cwd <repo> mcp`
- project-scoped `.codex/config.toml` write support
- project-scoped `.mcp.json` write support
- timestamped backups before updates
- rollback from an explicit backup path
- validation for client config names/commands
- CI smoke coverage for dry-run, write, and rollback paths
- daemonless `switchboard serve` debug/CI fallback documentation

Risk:

Global/user-scope installers before secrets may create configs we later need to
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

- mandate foundation
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

### Completed Slice: Daemon-Backed Install Snippets

Goal: make generated Codex and Claude snippets point at the daemon-backed MCP
adapter now that auto-start is reliable.

Acceptance:

- Codex install dry-run uses `switchboard --cwd <repo> mcp`
- Claude install dry-run uses `switchboard --cwd <repo> mcp`
- install docs use `mcp` as the primary path
- `serve` remains documented as debug/CI fallback
- Codex and Claude install smokes pass

### Completed Slice: Project-Scoped Client Installers

Goal: make Codex and Claude install commands useful without hand-editing config
while keeping writes repo-local and reversible.

Acceptance:

- `switchboard install codex --write` writes `.codex/config.toml`
- `switchboard install claude --write` writes `.mcp.json`
- dry-run remains the default
- existing config updates create timestamped backups
- `switchboard install <client> --rollback <backup>` restores a backup
- existing Codex/Claude config entries outside the Switchboard server are preserved
- CI smokes cover write and rollback for both clients

Deferred from full Milestone 8:

- interactive conflict diff and confirmation before replacing an existing
  `switchboard` client entry
- global/user-scope client config writes

### Completed Slice: Doctor Client Config Detection

Goal: make `switchboard doctor` aware of whether project-scoped Codex and
Claude config already route through Switchboard.

Acceptance:

- Doctor JSON includes Codex and Claude project client config status
- Human doctor output shows installed, missing, stale, or invalid client configs
- Missing/stale clients produce `switchboard install <client> --write` next steps
- Installed clients do not keep producing install next steps
- Invalid project client config is reported without mutating files

### Completed Slice: Existing MCP Server Discovery

Goal: make `switchboard doctor` surface other MCP servers already present in
project-scoped Codex and Claude config files before adding import behavior.

Acceptance:

- Doctor JSON includes other MCP server names for Codex and Claude project config
- Human doctor output shows other MCP server names when present
- Discovery is read-only and does not import or mutate config
- Existing missing/installed/stale/invalid client status behavior remains intact

### Completed Slice: Mandate Strategy Pivot

Goal: update product direction so Switchboard's durable wedge is task-scoped
authority for coding agents, not generic MCP gateway/profile routing alone.

Acceptance:

- Product docs introduce mandates as the long-term core primitive
- Roadmap preserves current daemon/install/audit work as mandate substrate
- Provider presets are explicitly gated behind mandate/secrets/policy work
- Next build slice is mandate foundation rather than provider integrations

### Current Slice: Mandate Runtime Context

Goal: make the MCP runtime aware of active mandates without claiming full
tool-level policy or approval enforcement yet.

Acceptance:

- `switchboard mcp --mandate <id>`
- `switchboard serve --mandate <id>`
- runtime validates the mandate is active for the repo
- runtime mounts only profiles bound to the mandate
- routed MCP tool-call audit entries include mandate id
- no provider integrations
- no secret broker
- no full policy engine yet
- no full approval broker yet

## Rules For Future Agents

- Read `docs/product/roadmap.md` and the relevant source docs before building.
- Use current docs for touched SDKs and client config formats.
- Keep CLI commands thin; reusable behavior belongs in packages.
- Do not add provider integrations before the secrets/policy/audit gates.
- Do not claim enforcement until the code actually enforces it.
- Keep every PR small, reviewed, tested, pushed, and mergeable.
