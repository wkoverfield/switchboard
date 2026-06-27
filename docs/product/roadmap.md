# Switchboard Roadmap

Last updated: 2026-06-27

This is the working roadmap for Switchboard. The source planning documents live in
`docs/product/source/` and are preserved source material from the original
planning thread. They are no longer product source of truth when they conflict
with this roadmap or `docs/product/mandate-strategy.md`.

## Source Documents

- `docs/product/source/switchboard-prd.md`
- `docs/product/source/switchboard-agentic-build-plan.md`
- `docs/product/source/switchboard-distribution-plan.md`
- `docs/product/source/switchboard-agent-discovery-kit.md`
- `docs/product/source/switchboard-agent-research-synthesis.md`
- `docs/product/source/switchboard-competitive-landscape.md`
- `docs/product/mandate-strategy.md`
- `docs/product/eval-strategy.md`
- `docs/product/adversarial-alpha-eval-2026-06-27.md`
- `docs/product/alpha-authority-architecture-plan.md`
- `docs/product/approval-elicitation-research.md`
- `docs/security/secrets-keychain-architecture.md`

## Product North Star

Switchboard gives coding agents the right tools for each repo, environment, and
task.

The simple user-facing entry point is still repo-aware MCP/environment setup:
project-scoped agent config, correct accounts/projects per repo, dev/prod
separation, fewer duplicate MCP configs, safer defaults, and local auditability.
Codex and Claude Code are the shipped installer path today; Cursor and VS Code
remain planned client surfaces.

The deeper product primitive is the local mandate layer for coding agents. A
mandate gives an agent temporary, task-scoped authority for a specific repo,
worktree, branch, role, profile set, tool surface, lease, approval posture, and
audit trail.

The June 2026 adversarial competitive read narrows the durable wedge: broad
"repo agent-readiness" overlaps with AGENTS.md/client instructions, skills,
MCP catalogs/gateways, secrets managers, and agent harnesses. Switchboard can
use setup helpers, provider templates, skills, and runbooks, but they should
serve the mandate layer rather than become the main product claim.

Switchboard should win by making delegated coding-agent work bounded without
forcing simple users to understand mandates on day one:

- one local MCP endpoint across coding-agent clients
- repo/worktree/branch-aware profile selection, not broad inherited human access
- optional task-scoped mandates for advanced workflows
- leases and expiry for agent access
- allowed/denied tool surfaces tied to task and role
- approval gates for sensitive actions
- audit and handoff state scoped to repo, task, and mandate
- clear profile namespaces so duplicate tool names are safe
- local-first config, secrets, and policy enforcement

## Layered Product Compass

Do not hard-pivot away from the infrastructure already built. Daemon-backed MCP
routing, project-scoped Codex/Claude install, reversible config writes, profile
routing, namespaces, repo-aware config, and audit logs are all required substrate
for mandates.

But do not make "agent authority" the only front-door product yet. The product
layers should be understood as conceptual depth, not build order:

1. Easy repo-aware MCP/environment setup for normal developers.
2. Task-scoped mandates for advanced local authority.
3. Delegation chains where a lead agent can create narrower child mandates.
4. Harness integration where external orchestrators request scoped authority.

Implementation should make active mandates harness-friendly before building
child mandate/delegation enforcement.

The next roadmap should optimize for:

- repo-aware setup as the obvious first value
- mandate/audit/policy/approval depth over provider breadth
- setup helpers that generate transparent plans, not opaque automatic authority
- profile selection attached to mandate context when mandates are active
- runtime/tool calls and audit logs carrying mandate id when active
- repo/worktree/branch-aware local enforcement over cloud gateway breadth
- reversible client install as distribution plumbing, not the product center
- scriptable JSON surfaces for external harnesses
- integrations with existing secrets managers, MCP gateways, skills systems, and
  harnesses where useful instead of replacing them

Provider presets and future `switchboard add` flows should be judged by whether
they make safe mandates easier to create and reuse. The better next demo is:

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

Longer term, Switchboard should support a mandate tree / local authority graph:
Wilson gives a lead agent a bounded mandate, the lead creates narrower child
mandates for worker agents, child mandates cannot exceed parent scope, privileged
actions escalate back to Wilson, and audit logs preserve the delegation chain.

Switchboard should not become the agent orchestrator. Claude Agent Teams, Codex,
LangGraph, HumanLayer, custom worktree scripts, and other harnesses can decide
what work gets assigned, which agents run, and how they communicate. Switchboard
decides what repo/worktree/branch context each agent gets, which MCP
profiles/tools it can use, what is denied, how long the lease lasts, when
approval is required, and how actions are audited.

## Current State

Implemented in the current codebase:

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
- mandate allow/deny tool patterns
- call-time mandate tool policy enforcement
- policy-filtered MCP `tools/list` under active mandates
- pre-discovery daemon denial for disallowed mandate tool calls
- denied-call audit entries
- human `mandate status` policy display
- mandate approval-required tool patterns
- conservative approval-required runtime blocking
- local approval request store
- `switchboard approvals`
- `switchboard approve <id>`
- `switchboard deny <id>`
- approved approval decisions honored by daemon-routed mandate calls
- optional bounded approval waits with `switchboard mcp --approval-wait <duration>`
- stale approval request status for disconnected approval waits
- daemon-start invalidation for leftover pending approval requests
- approval gate reason metadata in mandates and approval requests
- `switchboard mandate create --json` MCP launch payloads for harnesses
- MCP launch payloads include additive command candidates for PATH and current
  Node entrypoint launch modes
- `switchboard mandate child --parent <id>`
- child mandate parent/delegation metadata
- child mandate subset validation for profiles, allowed tools, lease, and
  repo/worktree/branch binding
- approval gate risk classes and structured labels
- immutable mandate UIDs for disambiguating repeated human mandate ids
- `switchboard mandate handoff <id>`
- closed handoff states remove runtime authority from mandates
- parent handoff is blocked while child mandates remain open
- `switchboard mandate report <id> --json`
- versioned `switchboard.mandate-report.v1` parent/child report payloads
- mandate reports include related audit entries and approval requests for the
  delegation chain
- mandate reports include selected-mandate readiness blockers for open children
  and pending approvals
- mandate reports include aggregated handoff results, next steps, and artifacts
- `switchboard mandate escalate <id> --json`
- versioned `switchboard.mandate-escalation.v1` local escalation plans
- versioned `switchboard.error.v1` JSON error envelopes for contracted mandate
  `--json` command failures
- versioned `switchboard.approvals.v1` approval request payloads
- `switchboard approvals --mandate <id> --include-children --json`
- approval request queues can be viewed across a parent/child mandate tree
- approval decisions are scoped to immutable mandate UIDs when available
- approval requests carry parent/delegation metadata when created under a child
  mandate
- local `secretRef` values backed by the OS keychain adapter
- `switchboard secrets set/list/remove/doctor`
- `switchboard auth <github-ci|vercel-preview>` human-friendly provider token
  storage over the same secretRef primitives
- `switchboard setup <github-ci|vercel-preview>` guided provider setup that
  writes config and stores the provider token in one happy-path command
- `switchboard scan` / `switchboard scan --json` read-only first-run repo scan
  for git, client config, Switchboard config, provider/env hints, warnings, and
  next actions without network calls or secret values
- runtime secret injection for configured stdio upstream env
- missing `secretRef` readiness in doctor, runtime errors, mandate reports, and
  mandate escalations
- secret-backed profile smoke coverage
- secret-backed mandate smoke coverage proving scoped `serve --mandate`,
  mandate-linked audit entries, and no raw secret values in CLI output, MCP
  responses, audit logs, or mandate reports
- provider safety template foundation with `switchboard presets list` and
  `switchboard presets show <github-ci|vercel-preview>`
- guided provider setup planner with `switchboard add <github-ci|vercel-preview>`
- `switchboard add <preset> --write` for repo-local `.switchboard.yaml`
  updates with backups
- provider-add JSON includes structured `commands` for harnesses in addition to
  human-readable shell strings
- `switchboard doctor` emits a top-level readiness status:
  `ok`, `setup-incomplete`, or `failed`
- `switchboard mandate create --from <github-ci|vercel-preview>`
- preset-backed mandate creation uses template defaults, the current git
  branch, and optional CLI overrides
- `pnpm smoke:harness-subagent-proof`
- `pnpm smoke:vercel-preview-dogfood`
- provider-aware `switchboard doctor` next steps for `github-ci` and
  `vercel-preview`
- readable human approval queues with exact inspect, approve, deny, and retry
  commands for gated tool calls
- `switchboard.mcp-launch.v1` structured follow-up commands and policy summary
  for harness startup, preflight, approval polling, reporting, logs,
  escalation, and child mandate templates
- `workspaceLease` launch hardening with `mcpLaunch.env`, runtime context,
  `runLaunch`, capability flags, and `switchboard.mcp-error.v1` runtime
  failures for harnesses
- structured credential guidance in provider safety templates and provider-add
  output for GitHub CI and Vercel Preview dogfood
- rendered `mandatePolicy` JSON in provider safety template and provider-add
  output for advanced users and harnesses
- provider dogfood runbook for least-privilege GitHub CI and Vercel Preview
  testing
- provider dogfood report template for recording live run evidence without raw
  tokens
- npm-packable alpha package metadata and `pnpm smoke:package-pack` for
  `@switchboard-mcp/core`, `@switchboard-mcp/mcp-runtime`, and
  `@switchboard-mcp/cli`
- alpha distribution doc with package pack checks, client install smokes, and
  known limitations
- public npm alpha packages:
  `@switchboard-mcp/core@0.1.0`,
  `@switchboard-mcp/mcp-runtime@0.1.0`, and
  `@switchboard-mcp/cli@0.1.0`
- redaction patch release shipped for
  `@switchboard-mcp/core@0.1.1`,
  `@switchboard-mcp/mcp-runtime@0.1.1`, and
  `@switchboard-mcp/cli@0.1.1`
- `pnpm eval:published-alpha` for public-package install/usefulness checks
- Bypass Findings V0 in `scan`, `doctor`, and import output, including
  high-risk direct MCP route classification and a failing doctor check for
  unresolved authority bypasses
- backup-protected `switchboard import --write --cleanup-client` for removing
  direct Codex/Claude MCP bypass routes from active project client config, with
  rollback commands and idempotent reruns
- `switchboard run --mandate <id> -- <command> [...args]` V0 for code-mode
  authority: validates mandate/runtime scope, injects mounted `secretRef` env
  values, denies shell/script wrappers by default, and audits redacted command
  execution metadata
- shared recommended-next-action planner plus `switchboard next`, surfaced in
  `scan`, `doctor`, and import output as one primary action with structured
  alternatives

Not started:

- richer policy engine and operating modes
- full approval broker
- richer mandate tree approval escalation and result aggregation beyond
  visibility/reporting
- global/user-scope client installers
- Supabase, PostHog, or Sentry integrations
- real Stripe test-mode MCP dogfood beyond the shipped `stripe-test` safety
  template

Remaining roadmap should be grouped into these buckets:

- Alpha Golden Path: GitHub CI is now the canonical first-run flow, with
  quickstart and alpha golden-path docs aligned to shipped commands. The
  remaining proof is that one non-Wilson developer can reach a ready mandate
  without help.
- Approval UX: make pending approval queues, approve/deny actions, stale
  decisions, and escalation copy easier for humans to operate during real
  agent work. The first human queue polish is shipped; approval watch mode and
  richer escalation copy remain.
- Harness Contracts: preserve versioned JSON payloads, expand structured
  command objects where useful, and keep parent/child authority flows
  scriptable without making Switchboard the orchestrator. V0 launch payloads
  now include structured follow-up commands and a policy summary.
- Real Provider Dogfood: deepen GitHub CI first, then Vercel Preview, using
  least-privilege tokens and real tool names before adding more providers.
  Credential guidance, the live dogfood runbook, and the report template are
  shipped; live least-privilege token runs still need a tester-supplied
  credential.
- Distribution: npm/package metadata, tarball pack smoke, install docs, and
  client install smokes are shipped for alpha. Demo media, registry assets, and
  more alpha examples remain.

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

Status: foundation complete; long-lived upstream session/cache work deferred.

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
- `switchboard mcp` stdio adapter
- daemon-backed MCP `tools/list` and `tools/call`
- auto-start from MCP adapter

### Milestone 4: Audit Logs + Doctor

Status: audit foundation and doctor guidance complete for the current substrate.

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
- `switchboard logs --mandate`
- denied mandate policy audit entries
- local-only audit docs

Why it matters soon:

Audit is one of the product's trust pillars and becomes harder to retrofit once
policy, approval, and provider-specific behavior exist.

### Milestone 5: Policy Engine + Operating Modes

Status: thin mandate tool policy shipped; richer engine not started.

Original modes:

- `inspect`
- `guarded`
- `autopilot`
- `unrestricted`

Recommended constraint:

Keep operating modes as config/schema concepts until approval and secrets are
designed. Avoid implying enforcement that Switchboard cannot yet provide.

Policy rules should be evaluated in the context of a mandate, not only a static
profile. Profile-level policy remains useful, but task/repo/worktree/branch/role
context is the differentiator.

### Milestone 6: Approval Broker

Status: local approval request store foundation shipped; full broker not
started.

Original intent:

- daemon-level approval queue
- CLI approval surface
- optional client elicitation later
- approval requests tied to mandate id, task, repo, branch, agent role, and tool

Do not build before:

- daemon lifecycle: shipped
- audit log: shipped
- basic policy classification: thin allow/deny shipped

Shipped foundation:

- replace the placeholder `approvalGates` array with typed gate records on
  mandates
- `switchboard mandate create --require-approval-tool <pattern>`
- denied-by-default behavior for approval-required tools until approvals exist
- audit entries tied to mandate id, tool, gate id, gate pattern, and reason
- local pending approval store
- `switchboard approvals`
- `switchboard approve <id>` / `switchboard deny <id>`
- runtime honors fresh approved decisions within mandate lease
- optional bounded in-call wait/poll behavior for daemon-backed MCP calls
- stale approval request status when a client disconnects during an approval
  wait
- daemon-start invalidation for leftover pending approval requests
- no provider integrations

Next acceptable slice:

- client elicitation research before implementing client-specific approval UX
- richer approval reasons and policy labels

### Milestone 7: Secrets

Status: foundation shipped; mandate-aware hardening still in progress.

Original intent:

- OS keychain on macOS
- env references as fallback
- no raw provider secrets in repo config or agent config

Do not build provider presets before this has at least a minimal mandate-aware
design.

Secrets should be granted to agents through a mandate lease where possible, not
through permanent inherited profile access.

Current decision:

- raw provider secrets stay out of repo config, agent client config, mandates,
  harness JSON payloads, and audit logs
- config uses printable `secretRef` ids
- native local OS-backed secret storage is the default backend
- fallback file/null/CLI backends require explicit unsafe dev/demo opt-in
- mandates grant temporary access to profiles/tools, not raw secrets
- provider presets remain blocked until mandate-scoped secret/profile behavior,
  provider-specific read/write/default mode policy, and audit redaction hold up
  in dogfood

See `docs/security/secrets-keychain-architecture.md`.

Shipped foundation:

- `SecretStore` interface and `cross-keychain` adapter behind a swappable core
  boundary
- backend policy hardening for native keychain backends by default
- readable `secretRef` ids mapped to keychain-safe account names
- value-free secret ref index
- config schema support for `{ secretRef }` upstream env values
- `switchboard secrets set/list/remove/doctor`
- missing-secret checks in `switchboard doctor`
- runtime secret resolution before `test`, `serve`, `tools`, and daemon-backed
  `mcp`
- generated Codex/Claude client configs remain value-free
- CI smoke proving a secretRef-backed fixture profile receives the exact
  resolved env value without printing it

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

Status: mostly pulled forward for profile/router setup; mandate-aware advanced
onboarding still thin.

Already shipped:

- `switchboard test <profile>`
- Codex/Claude client config dry-runs
- project-scoped Codex/Claude writes with rollback
- local audit log viewing
- `switchboard init`
- existing MCP config detection and read-only discovery
- dry-run/reversible writes
- doctor + profile test next-step guidance

Still needed:

- simple repo-aware setup flow that does not require mandates
- optional one-task-first mandate flow for advanced users
- copyable agent prompt that includes the active mandate id
- optional helper for installing a client entry that starts under a selected
  mandate

### Milestone 10: Provider Safety Templates

Status: safety-template foundation shipped for alpha; full integrations
deliberately deferred.

Original order:

- Supabase and Stripe first
- PostHog and Sentry by v1

Gate before starting:

- mandate foundation: shipped
- mandate runtime context: shipped
- mandate allow/deny tool policy: shipped
- implemented `secretRef` support in config/profile loading
- at least one local OS-backed secret backend
- doctor checks for missing referenced secrets without printing values
- runtime secret injection covered by tests
- generated client configs still contain no raw provider secrets
- mandate-scoped runtime behavior works with secret-backed profiles
- clear provider-specific read/write/default mode policy: started with safety
  templates
- audit redaction coverage for secret-backed profile use: shipped

New constraint: a provider preset must serve a mandate use case, such as a
bounded GitHub/Vercel CI-fix demo, rather than broad connector coverage.

Shipped foundation:

- `switchboard presets list`
- `switchboard presets show <github-ci|vercel-preview>`
- `switchboard presets check <github-ci|vercel-preview> --profile <profile>`
- `switchboard add <github-ci|vercel-preview>`
- `switchboard add <github-ci|vercel-preview> --write`
- `switchboard mandate create --from <github-ci|vercel-preview>`
- `switchboard.provider-preset.v1` JSON output for scripts/harnesses
- `switchboard.provider-preset-check.v1` JSON output for provider dogfood
- `switchboard.provider-add.v1` JSON output for guided setup plans
- provider-add JSON structured `commands` objects for scripts and harnesses
- schema-valid, value-free GitHub CI and Vercel Preview profile YAML templates
- recommended `secretRef` setup commands
- provider-level auth helper that stores the recommended token without requiring
  users to type the internal ref on the happy path
- guided provider setup command for alpha users who want one command before
  doctor/check/install/mandate
- recommended mandate allow/deny/approval policy for each template
- `switchboard doctor` readiness status values:
  `ok`, `setup-incomplete`, and `failed`
- observed tool classification against template policy, including
  allowed-sensitive warnings for write-like tools that are not denied or gated
- docs at `docs/providers/safety-templates.md`
- `pnpm smoke:provider-add`
- `pnpm smoke:github-ci-first-loop`
- `pnpm smoke:harness-subagent-proof`
- `pnpm smoke:vercel-preview-dogfood`
- live GitHub CI dogfood against the official GitHub MCP Docker server:
  43 tools discovered, 26 allowed, 15 approval-required, 2 denied,
  0 allowed-sensitive, 0 not-allowed
- dogfood report template for recording live run evidence and policy changes

Still needed:

- repeat live dogfood with a least-privilege token dedicated to CI-only use
- provider-specific doctor checks beyond the current preset check
- stronger policy defaults informed by real tool names
- more real Vercel Preview dogfood against a live project
- OAuth or provider auth flow, if a provider path needs it

### Milestone 11: Agent Discovery Kit + Distribution Assets

Status: alpha-ready distribution assets shipped; broader discovery assets remain
planned.

Already present:

- `llms.txt`
- `llms-full.txt`
- agent docs placeholders
- use-case docs placeholders
- GitHub CI alpha golden-path doc
- alpha distribution doc
- npm package metadata polish
- tarball pack smoke
- Codex and Claude install smokes

Still needed:

- more real examples from alpha testers
- demo GIF/script
- MCP directory listing assets
- agent recommendation docs updated from shipped behavior

### Milestone 12: Alpha Hardening

Status: started.

Alpha gate:

- fresh install smoke
- Codex install smoke
- Claude install smoke
- dogfood with a real repo
- no raw secrets in generated configs
- at least one non-Wilson developer can install without help

Current alpha focus:

- GitHub CI golden path stays canonical.
- Vercel Preview stays secondary proof that the model generalizes.
- Harness/subagent proof stays a JSON contract smoke, not a bundled
  orchestrator.

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

### Completed Slice: Mandate Tool Policy

Goal: add the thinnest enforceable tool policy around active mandate context
without building approvals, secrets, or provider-specific integrations.

Acceptance:

- `switchboard mandate create --allow-tool <pattern>`
- `switchboard mandate create --deny-tool <pattern>`
- policy patterns match namespaced tool names, with `*` wildcard support
- deny patterns win over allow patterns
- non-empty allow lists deny unmatched tools
- denied MCP tool calls are blocked before upstream routing
- denied MCP tool calls are audited with mandate id and policy error
- no provider integrations
- no secret broker
- no full approval broker yet

### Completed Slice: Product Compass Reset

Goal: land the roadmap adjustment before more build momentum accumulates around
the older MCP-profile-manager thesis.

Acceptance:

- docs state that daemon/install/audit/profile routing are mandate substrate
- roadmap names mandates as the product primitive
- provider presets are explicitly deferred unless they support mandates
- next build sequence prioritizes approval/policy/audit depth
- agent instructions no longer describe the active scope as Milestone 0/1 only

### Completed Slice: Approval Gate Foundation

Goal: make mandate policy express "allowed only with approval" without building
provider-specific integrations or a cloud service.

Acceptance:

- mandate schema can store typed approval gates for namespaced tool patterns
- `switchboard mandate create` can add approval-gated tool patterns
- daemon/runtime detects approval-required calls under an active mandate
- approval-required calls create local approval requests through the daemon path
- audit entries include mandate id, tool name, gate id or pattern, and status
- no provider presets
- no secrets broker
- no remote service

### Completed Slice: Approval Lifecycle Polish

Goal: make the local approval loop understandable and auditable before adding
in-call waits or client elicitation.

Acceptance:

- `switchboard approvals --status expired` filters by runtime status
- human approval output shows next actions for pending and expired requests
- daemon approval-required errors tell the agent/user how to approve and retry
- approved gated calls remain audit-linked to approval request id
- no provider presets
- no secrets broker
- no remote service

### Completed Slice: Bounded Approval Waits

Goal: reduce approval retry friction for clients that tolerate pending tool
calls without building client-specific elicitation or a remote broker.

Acceptance:

- `switchboard mcp --approval-wait <duration>` accepts bounded waits up to 10m
- daemon protocol carries approval wait duration on mandate-scoped tool calls
- approval-gated calls create/reuse local approval requests, then poll for a
  local approve/deny decision during the wait window
- approved requests route the original tool call and preserve audit linkage
- denied, expired, or timed-out requests return clear errors
- no provider presets
- no secrets broker
- no remote service

### Completed Slice: Approval Stale Semantics

Goal: make stale approval requests explicit so approvals cannot be granted
after the originating call disappears.

Acceptance:

- approval request schema supports terminal `stale` status
- `switchboard approvals --status stale` filters stale requests
- stale requests cannot be approved later
- stale requests do not dedupe future approval requests
- daemon marks a waiting approval request stale if the MCP client disconnects
  during `--approval-wait`
- no provider presets
- no secrets broker
- no remote service

### Completed Slice: Daemon Restart Approval Invalidation

Goal: prevent leftover pending approval requests from surviving daemon restarts.

Acceptance:

- core can mark pending approval requests stale by repo
- daemon startup marks leftover pending approval requests for its repo stale
- approved, denied, expired, stale, and other-repo requests are not rewritten
- stale requests cannot be approved later
- no provider presets
- no secrets broker
- no remote service

### Completed Slice: Approval Reason Metadata

Goal: make approval requests easier to evaluate by carrying the reason a gate
exists into mandate and approval surfaces.

Acceptance:

- `switchboard mandate create --require-approval-reason <reason>` stores gate
  reasons alongside `--require-approval-tool`
- mandate status displays approval gate reasons
- daemon-created approval requests copy the gate reason
- `switchboard approvals` and approval decisions display gate reasons
- no provider presets
- no secrets broker
- no remote service

Follow-up slice:

- client elicitation research before implementing client-specific approval UX
- policy labels/risk classes beyond free-form reasons

### Completed Slice: Harness-Friendly Mandate Surfaces

Goal: make active mandate use scriptable for external harnesses without turning
Switchboard into an orchestrator.

Acceptance:

- `switchboard mandate create --json` returns stable machine-readable mandate
  data plus an MCP launch command/args payload for `switchboard mcp --mandate`
- the launch payload includes a schema/version marker, mandate id, repo cwd,
  command, and args; args include `--cwd <repo> mcp --mandate <id>` so harnesses
  do not infer repo scope from their own process cwd
- `switchboard mandate status --json` remains repo/worktree aware and stable
  enough for harness polling
- `switchboard logs --mandate <id> --json` is documented as the post-run
  inspection surface
- docs show how a harness can request a scoped mandate, launch an agent with the
  scoped MCP endpoint, and inspect logs afterward
- parent/child mandate schema is sketched but not enforced until the basic
  active-mandate flow stays solid
- no provider presets
- no secrets broker
- no full orchestrator

### Completed Slice: Approval Risk Labels

Goal: make approval gates easier to scan and automate by adding descriptive
structured metadata without changing enforcement semantics.

Acceptance:

- mandate approval gates can carry risk classes: `low`, `medium`, `high`, or
  `critical`
- mandate approval gates can carry normalized structured labels
- `switchboard mandate create` accepts repeatable approval risk and label flags
- daemon-created approval requests copy gate risk and labels
- `mandate status`, `approvals`, and JSON output expose risk and labels
- invalid risk/label values are rejected before persistence
- no provider presets
- no secrets broker
- no new enforcement claims

Recommended next slice:

- client elicitation research before implementing client-specific approval UX
- keep provider presets deferred unless needed for profile/mandate safety

### Completed Slice: Approval Elicitation Research

Goal: decide how Switchboard should integrate approval prompts with MCP clients
without assuming every client supports the same user-interaction surface.

Acceptance:

- document MCP elicitation capabilities and safety constraints
- document Codex and Claude Code approval/elicitation surfaces from current docs
- recommend the smallest compatible Switchboard behavior
- keep current CLI approval store as the fallback path
- do not build client-specific approval UX in this slice
- no provider presets
- no secrets broker
- no full orchestrator

### Completed Slice: MCP Form-Mode Approval Elicitation

Goal: let MCP clients that advertise form elicitation decide mandate approval
requests in-client while keeping the local approval store and CLI fallback as
the source of truth.

Acceptance:

- daemon approval-required responses include structured non-secret approval
  context for the MCP adapter
- the daemon-backed MCP front door detects client form elicitation support
- form-capable clients receive a non-secret approve/deny elicitation prompt
- accepted approve/deny decisions persist through the existing approval request
  store
- approved decisions retry the original tool call
- declined, cancelled, unsupported, or errored elicitation falls back to current
  pending approval retry behavior
- approval elicitation attempts and decisions are audit-linked to mandate id and
  approval request id
- current `switchboard approvals`, `switchboard approve`, `switchboard deny`,
  and `--approval-wait` behavior remains available
- approval-required tools remain discoverable through `tools/list` with
  `_meta.switchboard.approvalRequired` metadata while execution stays gated
- `switchboard tools --mandate <id> --json` exposes the scoped tool surface for
  harness preflight without launching a worker agent
- approval gates do not expand mandate allow lists; disallowed and denied tools
  remain hidden and blocked
- upstream tool `_meta.switchboard` values are not trusted as Switchboard policy
  metadata
- no URL-mode elicitation
- no provider OAuth/secrets flows
- no remote approval service
- no child mandate delegation

### Completed Slice: Harness JSON Contracts

Goal: make the first harness-facing mandate surfaces stable enough for external
scripts to detect and branch on response versions before child mandate work
arrives.

Acceptance:

- `switchboard mandate create --json` keeps returning a versioned `mcpLaunch`
  payload for scoped MCP startup
- `switchboard mandate status --json` returns a top-level `schemaVersion` for
  the mandate-status contract
- `switchboard tools --mandate <id> --json` returns a top-level
  `schemaVersion` for the tool-surface contract
- docs name the current mandate-status and tool-surface schema versions
- docs include a harness JSON contract table that distinguishes versioned
  contracts from provisional JSON outputs
- no behavior change to mandate enforcement, approval waits, or MCP routing
- no provider OAuth/secrets flows
- no remote approval service
- no child mandate delegation

### Completed Slice: Child Mandates V0

Goal: turn the mandate direction into a local authority graph primitive without
building a full orchestrator.

Acceptance:

- mandate schema persists `parentMandateId`, `delegatedBy`, `delegationPath`,
  and `maxLeaseExpiresAt`
- `switchboard mandate child <task> --parent <id> ... --json` creates a child
  mandate from an active parent
- child mandates inherit parent denied tools and approval gates
- child profiles must be a subset of parent profiles
- child allowed tools must be within parent allowed tool scope
- child repo, worktree, and branch must match parent scope
- child lease cannot outlive parent lease
- child JSON output returns the existing versioned `mcpLaunch` payload
- mandate status and human output expose parent/delegation context
- no approval escalation broker
- no provider OAuth/secrets flows
- no remote service
- no full agent orchestrator

### Completed Slice: Mandate Handoff / Reporting V0

Goal: give external harnesses a scriptable way to close delegated work, preserve
handoff context, and inspect the resulting parent/child authority chain.

Acceptance:

- mandate schema persists non-open handoff states plus summary, next steps,
  artifacts, actor, and timestamp
- `switchboard mandate handoff <id> --state completed|blocked|cancelled`
  closes a mandate and makes it unavailable to `switchboard mcp --mandate`
- parent mandates cannot hand off while child mandates remain open
- `switchboard mandate report <id> --json` returns a versioned
  `switchboard.mandate-report.v1` payload
- report payload includes selected mandate id, root mandate id, children by
  parent, mandate counts, runtime counts, and related audit entries
- lifecycle smoke covers create, child, logs, handoff, and report
- no approval escalation broker
- no provider OAuth/secrets flows
- no remote service
- no full agent orchestrator

### Completed Slice: Mandate Tree Approval Visibility V0

Goal: give external harnesses and local users a versioned view of approval
queues across a delegated mandate tree without building a remote approval
broker.

Acceptance:

- approval request records can carry immutable mandate UIDs and optional
  parent/delegation metadata
- approved request reuse is scoped to the active mandate UID when available
- daemon-created approval requests copy active mandate delegation context
- `switchboard approvals --json` returns top-level
  `schemaVersion: "switchboard.approvals.v1"`
- `switchboard approvals --mandate <id> --include-children --json` includes
  current parent/child mandate requests while avoiding stale reused human ids
- approval queue payloads include request counts by runtime status
- tree approval payloads include matching mandates and `childrenByParent`
- mandate report payloads include related approval requests for the selected
  delegation chain
- repeated human mandate ids do not mix old and new approval queues
- docs name the approval request JSON contract for harness consumers
- no remote approval service
- no secrets broker
- no provider OAuth/secrets flows
- no full agent orchestrator

### Completed Slice: Mandate Tree Readiness V0

Goal: make mandate reports tell harnesses whether the selected mandate is ready
to hand off before adding richer escalation or orchestration.

Acceptance:

- `switchboard mandate report <id> --json` includes an additive `readiness`
  object
- readiness reports whether the selected mandate can be handed off now
- readiness lists open child mandates in the selected mandate subtree
- readiness lists pending approval requests in the selected mandate subtree
- human report output shows readiness blockers
- no approval escalation broker
- no provider OAuth/secrets flows
- no remote service
- no full agent orchestrator

### Completed Slice: Mandate Tree Result Aggregation V0

Goal: make mandate reports summarize delegated work outcomes for harnesses and
humans before adding richer escalation or orchestration.

Acceptance:

- `switchboard mandate report <id> --json` includes an additive `results`
  object
- results count handoffs by state plus open mandates, summaries, next steps,
  and artifacts
- results list completed/blocked/cancelled mandate handoffs with actor,
  timestamp, summary, next steps, and artifacts
- results provide flattened next-step and artifact rollups keyed by mandate id
- human report output shows result counts and handoff summaries
- no approval escalation broker
- no provider OAuth/secrets flows
- no remote service
- no full agent orchestrator

### Completed Slice: Local Escalation Plan V0

Goal: give harnesses and humans a local, scriptable escalation plan for a
mandate tree without building a broker or remote notification service.

Acceptance:

- `switchboard mandate escalate <id> --json` emits
  `schemaVersion: "switchboard.mandate-escalation.v1"`
- escalation items include pending approval requests with approve/deny commands
- escalation items include open child mandates with report/handoff commands
- escalation items include blocked/cancelled handoffs for human review
- payload includes deduplicated `nextCommands` and copyable human escalation
  text
- human output shows escalation status, items, and suggested local commands
- `switchboard mandate handoff` refuses local readiness blockers by default
- `switchboard mandate handoff --ignore-readiness` is the explicit escape hatch
  for softer local blockers such as pending approvals; core open-child blocking
  still applies
- no approval decisions are made automatically
- no remote service, notification channel, provider OAuth/secrets flow, or full
  orchestrator

### Completed Slice: JSON Error Envelope V0

Goal: make contracted mandate `--json` command failures parseable for external
harnesses while preserving normal human stderr behavior.

Acceptance:

- contracted mandate commands emit `schemaVersion: "switchboard.error.v1"` on
  failure when `--json` is supplied
- JSON error envelopes include `ok: false`, stable `code`, `message`, and
  `nextActions`
- JSON error envelopes are written to stdout and the process exits non-zero
- parser failures such as missing required options, missing required arguments,
  and unknown options are covered for contracted mandate commands
- missing mandate ids use the semantic `mandate_not_found` code across
  contracted mandate commands
- non-JSON command failures remain human-readable on stderr
- tests cover validation failures, missing mandate ids, and readiness-blocked
  handoffs
- docs explain success/error parsing for harness consumers

### Completed Slice: MCP Launch Command Candidates V0

Goal: make harness startup payloads usable both for installed Switchboard CLIs
and source-checkout dogfooding where `switchboard` is not on `PATH`.

Acceptance:

- `switchboard mandate create --json` and `switchboard mandate child --json`
  keep existing `mcpLaunch.command` and `mcpLaunch.args` for compatibility
- `mcpLaunch` adds `commandCandidates` with a `path` candidate for
  `switchboard`, plus either a built `current-entrypoint` candidate or source
  checkout `source-entrypoint` candidate depending on how the CLI is running
- `mcpLaunch` includes an install/use hint explaining when to use candidates
- docs explain that harnesses can choose a candidate when `switchboard` is not
  on `PATH`
- the smoke suite verifies the emitted built entrypoint candidate can launch
  the MCP command help
- no changes to MCP routing, mandate enforcement, or provider integrations

### Completed Slice: Child Approval Gate Duplicate UX V0

Goal: make inherited child approval-gate behavior explicit so lead agents do not
think a child-provided reason, risk, or label overrides the parent's gate.

Acceptance:

- `createChildMandate` rejects child approval gates whose tool pattern is
  already inherited from the parent
- the error tells users to omit the duplicate inherited gate or choose a
  narrower tool pattern
- `switchboard mandate child --json` returns the error through
  `switchboard.error.v1`
- child mandates can still add non-duplicate stricter approval gates
- docs explain the duplicate inherited-gate rule for harness authors
- no changes to approval execution, approval requests, MCP routing, providers,
  or daemon behavior

### Completed Slice: Ephemeral Doctor Local Config Hygiene V0

Goal: keep `switchboard doctor` useful in temporary harness repos and smoke
test folders without weakening the safety check for real local overrides.

Acceptance:

- local-config hygiene passes when no `.switchboard.local.yaml` exists yet
- local-config hygiene still fails when `.switchboard.local.yaml` exists and is
  not ignored by git
- `switchboard doctor --json` avoids gitignore next-step noise for ephemeral
  repos with no local override file
- human doctor output still explains that local overrides should be ignored
  before storing local-only settings
- tests cover no-local-config, no-gitignore, unignored-local-config, and CLI
  doctor behavior
- no changes to config precedence, profile schemas, MCP routing, mandate
  enforcement, providers, or daemon behavior

### Completed Slice: Versioned Audit Log JSON V0

Goal: make post-run mandate audit inspection a stable harness-facing JSON
contract without changing audit writing or runtime enforcement.

Acceptance:

- `switchboard logs --json` includes `schemaVersion:
  "switchboard.audit-log.v1"`
- JSON output keeps compatible top-level `path`, `mandateId`, and `entries`
  fields
- JSON output includes explicit `filters` and `counts` metadata
- `switchboard logs --mandate <id> --json` reports matching and returned entry
  counts after mandate filtering
- invalid `logs --json --limit` values return `switchboard.error.v1` on stdout
  with a non-zero exit code
- docs move audit logs from provisional to versioned harness contract
- no changes to audit writing, MCP routing, mandate enforcement, providers, or
  daemon behavior

### Completed Slice: Approval Request JSON Error Envelopes V0

Goal: make the versioned approval queue surface parseable on failure for
harnesses without changing approval execution or request storage.

Acceptance:

- `switchboard approvals --json` validation failures emit
  `switchboard.error.v1` on stdout and exit non-zero
- invalid `--status` values include a stable `invalid_status` code
- `--include-children --json` without `--mandate` includes a stable
  `missing_mandate` code
- `--include-children --all --json` includes a stable `invalid_scope` code
- missing mandate ids in tree approval mode use `mandate_not_found`
- parser failures for `approvals --json` emit `switchboard.error.v1`
- non-JSON human stderr behavior is preserved
- docs clarify that approval queue failures are contracted error envelopes
- no changes to approval execution, approval request storage, MCP routing,
  providers, or daemon behavior

### Completed Slice: Tool Surface JSON Error Envelopes V0

Goal: make the versioned tool-surface preflight contract parseable on failure
for harnesses without changing tool discovery, MCP routing, or policy
enforcement.

Acceptance:

- `switchboard tools --json` validation/config failures emit
  `switchboard.error.v1` on stdout and exit non-zero
- missing mandate ids under `tools --mandate <id> --json` use
  `mandate_not_found`
- no stdio upstream profiles under `tools --json` use `no_stdio_profiles`
- tool discovery failures under `tools --json` use `tool_surface_failed`
- parser failures for `tools --json` emit `switchboard.error.v1`
- non-JSON human stderr behavior is preserved
- docs clarify that tool-surface failures are contracted error envelopes
- no changes to tool discovery semantics, MCP routing, mandate enforcement,
  providers, or daemon behavior

### Completed Slice: Front-Door Approval Metadata Smoke V0

Goal: prove that approval-required tool metadata survives the actual MCP
front-door `tools/list` path for daemonless mandate-scoped servers.

Acceptance:

- MCP client/server front-door smoke lists a mandate approval-gated tool
- listed gated tool includes `_meta.switchboard.approvalRequired`
- listed gated tool includes non-secret gate reason, risk, and labels
- listed ungated tools still include normal Switchboard routing metadata
- listed ungated tools do not receive approval-required metadata
- no changes to runtime behavior, approval execution, daemon behavior,
  provider integrations, or client installers

### Completed Slice: Launched Serve Mandate Approval Metadata Smoke V0

Goal: prove that approval-required tool metadata survives a built CLI
`switchboard serve --mandate <id>` stdio session, not only in-process MCP tests.

Acceptance:

- existing built CLI `serve` smoke still lists and calls fixture tools
- smoke creates a local mandate bound to the fixture stdio profile
- smoke launches built CLI `switchboard serve --mandate fix-ci`
- MCP `tools/list` exposes `_meta.switchboard.approvalRequired` for the gated
  fixture tool
- gated metadata includes non-secret reason, risk, and labels
- ungated fixture tools keep routing metadata and omit approval metadata
- no changes to runtime behavior, approval execution, daemon behavior,
  provider integrations, or client installers

### Completed Slice: Mandate Human Next Commands UX V0

Goal: make the manual mandate demo path self-guiding without changing JSON
contracts or enforcement behavior.

Acceptance:

- human `switchboard mandate create` output includes a next-command block for
  tool preflight, scoped MCP launch, approval inspection, audit logs, and handoff
- human `switchboard tools --mandate <id>` output includes next commands for
  scoped MCP launch, approval inspection, audit logs, and handoff
- suggested commands include explicit `--cwd <repo>` context so they are
  copyable from outside the repository
- the primary tool preflight suggestion uses human output; harnesses can still
  add `--json` when they need the versioned contract
- JSON payloads and harness-facing contracts remain unchanged
- tests cover human create and human tool-surface output
- no changes to runtime behavior, approval execution, daemon behavior,
  provider integrations, or client installers

### Completed Slice: Mandate Walkthrough Smoke V0

Goal: exercise the first credible end-to-end mandate demo with the built CLI,
daemon-backed scoped MCP, local approvals, audit inspection, and handoff.

Acceptance:

- smoke uses a temporary repo with a fixture stdio upstream profile
- smoke proves human `mandate create` and `tools --mandate` outputs include
  repo-aware next commands
- smoke proves `tools --mandate --json` exposes the versioned scoped tool
  surface and approval metadata
- smoke launches `switchboard mcp --mandate <id>` through the built CLI
- smoke creates a real local approval request from a gated MCP tool call
- smoke approves the request through the CLI and retries the gated call
- smoke verifies mandate-scoped audit logs include approval-required and
  approved-call entries
- smoke closes the mandate with handoff and verifies the versioned report
- CI runs the walkthrough smoke with the rest of the smoke suite
- no provider integrations, secrets broker, remote service, or orchestrator

### Completed Slice: Mandate Demo Runbook V0

Goal: turn the automated mandate walkthrough into a human-readable local
dogfood/demo path without adding providers, secrets, or new runtime behavior.

Acceptance:

- docs include a local mandate demo runbook using the fixture stdio profile
- runbook covers setup, mandate creation, scoped tool inspection, MCP launch,
  approvals, logs, handoff, and report
- runbook distinguishes human commands from harness JSON surfaces
- runbook points to `pnpm smoke:mandate-walkthrough` for the fully automated MCP
  approval path
- README and harness docs link to the runbook
- no provider integrations, secrets broker, remote service, or orchestrator
- no keychain/secrets architecture decision in this slice

### Completed Slice: Mandate Demo Helper V0

Goal: make the local mandate dogfood path discoverable from the CLI by printing
profile-specific demo commands without creating mandates or changing runtime
behavior.

Acceptance:

- `switchboard demo mandate [profile]` prints a local demo sequence for a stdio
  profile
- the command defaults to the first configured stdio profile when no profile is
  supplied
- output includes repo, profile, namespace, task, mandate id, installed CLI
  commands, source-checkout prefix guidance, and the automated smoke command
- default task names avoid immediate rerun collisions
- generated commands cover mandate create, tool preflight, MCP launch,
  approvals, logs, handoff, and report
- missing or non-stdio profiles fail clearly
- README and demo runbook mention the helper
- no provider integrations, secrets broker, remote service, or orchestrator
- no keychain/secrets architecture decision in this slice

### Completed Slice: Secrets and Keychain Architecture V0

Goal: make the credential boundary explicit before provider presets or secret
runtime work starts.

Acceptance:

- document the local-first secrets/keychain architecture
- keep raw provider secrets out of repo config, agent client config, mandates,
  harness JSON payloads, and audit logs
- define `secretRef` as the config/profile binding primitive
- explain how active mandates grant profile/tool access without containing raw
  secrets
- define the provider preset gate before Supabase/Stripe/GitHub/Vercel-style
  presets can start
- list implementation questions for the future secrets CLI/backend PR
- update roadmap and trust docs
- no provider integrations
- no secret backend implementation
- no remote service or cloud broker

### Completed Slice: Secrets Foundation V0

Goal: make local secret refs real enough for profiles and mandates without
starting provider presets.

Acceptance:

- add a core `SecretStore` interface and default local keychain-backed adapter
- add config schema support for upstream env values using `{ secretRef: string }`
  while preserving harmless literal env values
- add `switchboard secrets set <ref> --value-stdin`
- add `switchboard secrets list` without printing values
- add `switchboard secrets remove <ref>`
- add `switchboard secrets doctor`
- add `switchboard doctor` missing-secret checks and next steps
- resolve secret-backed env values before `test`, `serve`, `tools`, and
  daemon-backed `mcp` upstream launches
- keep generated Codex/Claude config value-free
- add tests for validation, missing-secret doctor behavior, secret runtime
  injection, generated-config safety, and no secret values in command output
- add CI smoke coverage for a secretRef-backed fixture profile that proves
  runtime env injection without printing secret values
- no provider presets
- no provider OAuth
- no cloud secret broker

### Current Slice: Mandate-Scoped Secret Readiness V0

Goal: close the gap between "profiles can use secretRefs" and "mandates can be
trusted as the local authority context for secret-backed profiles."

Acceptance:

- mandate-scoped tool/profile surfaces report missing secretRefs only for
  profiles mounted by the active mandate
- mandate report/escalation surfaces include non-secret readiness blockers for
  missing secretRefs when they block a scoped run
- audit entries for secret-backed profile runs remain value-redacted and include
  mandate context when active
- docs explain that mandates bind profile access, not raw secret values
- no provider presets
- no provider OAuth
- no cloud secret broker

## Rules For Future Agents

- Read `docs/product/roadmap.md` and the relevant source docs before building.
- Use current docs for touched SDKs and client config formats.
- Keep CLI commands thin; reusable behavior belongs in packages.
- Do not add provider integrations before mandate-aware secrets/policy/audit
  gates.
- Do not claim enforcement until the code actually enforces it.
- Do not make mandates mandatory for simple repo-aware MCP setup.
- Build JSON-friendly CLI surfaces for harnesses before broad provider breadth.
- Keep every PR small, reviewed, tested, pushed, and mergeable.
