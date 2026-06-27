# Switchboard

Repo-aware MCP setup and task-scoped authority for agentic software work.

Your agents should know which tools belong to this repo.

Switchboard gives coding agents the right tools for each repo, environment, and task. The simple entry point is local-first MCP setup for developers using Codex, Claude Code, Cursor, VS Code, and other MCP-compatible agents: `switchboard scan` detects repo/account/provider hints without network calls or secret values, guided setup creates project-scoped config, and production-safe defaults keep raw secrets out of config/output while nudging risky provider actions toward non-prod profiles, approval gates, leases, and audit logs. Codex and Claude Code are shipped installer targets today; Cursor and VS Code remain planned surfaces.

The deeper power layer is mandates: temporary, task-scoped authority that lets agents do bounded jobs without inheriting a human's whole tool surface. Mandates stay optional for simple setup, but they give advanced users and external harnesses a way to bind profiles, tools, leases, approvals, and audit logs to a specific task.

This repository is in foundation work for the local mandate layer. It currently ships the TypeScript workspace, CLI shell, local `switchboard scan`, config/profile schemas, namespace normalization, collision detection, `switchboard status`, `switchboard doctor` with `ok` / `setup-incomplete` / `failed` readiness, generic stdio MCP upstream mounting, namespaced tool routing, a stdio MCP front door, client config dry-run and write-mode installers for Codex and Claude Code, project client config and existing MCP server detection in doctor, local audit logs, daemon lifecycle commands, daemon-side tool discovery, a daemon-backed MCP adapter for tool listing and routed calls, local mandate creation/status, preset-backed `switchboard mandate create --from <preset>`, mandate-scoped MCP runtime context, mandate allow/deny tool policy, local secret refs backed by a keychain adapter, provider-add structured command JSON, and end-to-end MCP smoke checks.

## Install

Alpha package install:

```bash
npm install -g @switchboard-mcp/cli
switchboard --help
```

For one-off or harness use without a global install:

```bash
npx -y @switchboard-mcp/cli@latest --help
```

Then run the repo setup flow from the project you want agents to work in:

```bash
switchboard scan
switchboard import --dry-run
switchboard setup github-ci
switchboard doctor
switchboard install codex --write
switchboard mandate create --from github-ci
```

## Install From Source

```bash
pnpm install
pnpm build
pnpm switchboard --help
pnpm smoke:profile-test
pnpm smoke:secret-ref-profile
pnpm smoke:mandate-secret-ref
pnpm smoke:provider-add
pnpm smoke:import-dry-run
pnpm smoke:github-ci-first-loop
pnpm smoke:harness-subagent-proof
pnpm smoke:vercel-preview-dogfood
pnpm smoke:mcp-serve-session
```

From a source checkout, use `pnpm switchboard ...` in place of a globally
installed `switchboard` binary:

```bash
pnpm switchboard doctor
pnpm switchboard scan
pnpm switchboard add github-ci --write
```

## Current Commands

```bash
switchboard --help
switchboard scan
switchboard scan --json
switchboard import --dry-run
switchboard import --json
switchboard import --write
switchboard init
switchboard setup <github-ci|vercel-preview>
switchboard add <github-ci|vercel-preview>
switchboard add <github-ci|vercel-preview> --write
switchboard status
switchboard doctor
switchboard demo mandate [profile]
switchboard test <profile>
switchboard auth <github-ci|vercel-preview>
switchboard install <codex|claude>
switchboard install <codex|claude> --write
switchboard install <codex|claude> --rollback <backup>
switchboard mandate create --from github-ci
switchboard mandate create --from <github-ci|vercel-preview> --json
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --allow-tool <pattern> --deny-tool <pattern>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --require-approval-tool <pattern> --require-approval-reason <reason>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --require-approval-tool <pattern> --require-approval-risk <risk> --require-approval-label <label>
switchboard mandate child <task> --parent <id> --agent <role> --profiles <profiles> --branch <branch> --lease <duration>
switchboard mandate status [id]
switchboard tools
switchboard tools --mandate <id> --json
switchboard approvals
switchboard approvals --status <pending|approved|denied|stale|expired>
switchboard approve <approval-id>
switchboard deny <approval-id>
switchboard secrets set <ref> --value-stdin
switchboard secrets list
switchboard secrets remove <ref>
switchboard secrets doctor
switchboard presets list
switchboard presets show <github-ci|vercel-preview>
switchboard presets check <github-ci|vercel-preview> --profile <profile>
switchboard logs
switchboard logs --mandate <id>
switchboard daemon <status|start|ping|tools|stop>
switchboard mcp
switchboard mcp --mandate <id>
switchboard mcp --mandate <id> --approval-wait <duration>
switchboard serve
switchboard serve --mandate <id>
```

## Product Roadmap

The current working roadmap lives at `docs/product/roadmap.md`. The mandate
strategy lives at `docs/product/mandate-strategy.md`. Original planning-thread
source docs are preserved in `docs/product/source/`.
Alpha packaging and tarball checks live in
`docs/install/alpha-distribution.md`.
The accepted local secrets/keychain direction lives at
`docs/security/secrets-keychain-architecture.md`; provider templates use that
work through local `secretRef`s. Local secrets use OS-protected keychain
backends by default;
file/null/CLI fallbacks require an explicit
`SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS=1` dev or demo opt-in.
Harness-facing JSON contracts, including `switchboard.error.v1` failure
envelopes for mandate `--json` commands, are summarized in
`docs/use-cases/harness-json-contracts.md`. For a local human dogfood path,
use `docs/use-cases/mandate-demo-runbook.md`. For the alpha GitHub CI path, use
`docs/use-cases/github-ci-alpha-golden-path.md`. Provider safety templates for
value-free GitHub/Vercel-style profile setup live in
`docs/providers/safety-templates.md`; live provider testing should follow
`docs/use-cases/provider-dogfood-runbook.md`.

## Config Files

Switchboard reads layered YAML config:

```text
$XDG_CONFIG_HOME/switchboard/config.yaml
~/.config/switchboard/config.yaml
.switchboard.yaml
.switchboard.local.yaml
```

This repo includes a safe `.switchboard.yaml` fixture so `switchboard status` and `switchboard doctor` exercise repo config discovery. Copy `.switchboard.local.example.yaml` to `.switchboard.local.yaml` for local-only overrides; the real local override file is gitignored.

Precedence, highest to lowest:

1. CLI overrides
2. environment variables
3. `.switchboard.local.yaml`
4. nearest `.switchboard.yaml`
5. global config
6. built-in defaults

Start with `docs/install/quickstart.md`. `switchboard init` prints or writes a starter repo config, and `switchboard doctor` tells you the next command to run, including whether project Codex/Claude config is missing, stale, installed, invalid, or missing referenced local secrets. `switchboard auth <preset>` stores the recommended provider token for a preset without making humans type the internal ref. `switchboard secrets set <ref> --value-stdin`, `switchboard secrets list`, `switchboard secrets remove <ref>`, and `switchboard secrets doctor` remain the lower-level scriptable secret primitives backed by the OS keychain adapter; lists and JSON output never print secret values. Config can reference upstream env secrets as `{ secretRef: "github/findu/dev/token" }`, and runtime commands resolve those refs only before launching permitted upstream profiles. `pnpm smoke:secret-ref-profile` proves this path end to end with an isolated dev-only backend and a fixture MCP server that reports only whether the env value is present. `pnpm smoke:mandate-secret-ref` proves the same secret-backed profile can be mounted through `serve --mandate`, produces mandate-linked audit entries, and keeps the raw secret out of CLI output, MCP responses, audit logs, and mandate reports. `switchboard test <profile>` checks that a configured stdio upstream starts and lists tools. `switchboard tools --mandate <id> --json` gives scripts and harnesses the repo/mandate-scoped tool surface, including approval-gated tool metadata, without launching an agent client; the response is tagged with `schemaVersion: "switchboard.tool-surface.v1"`. `switchboard mcp` auto-starts the local daemon when needed and supports daemon-backed tool listing and routed tool calls; add `--mandate <id>` to validate an active mandate, mount that mandate's profiles, enforce its allow/deny/approval-required tool patterns, and attach the mandate id to tool-call audit entries. Approval-required tools remain discoverable with `_meta.switchboard.approvalRequired`, but execution still creates a local approval request and returns retry instructions by default; when the connected MCP client advertises form elicitation support, Switchboard can ask for an in-client approve/deny decision, persist it through the same local approval store, and retry approved calls. Add `--approval-wait 30s` or another duration up to `10m` to keep gated tool calls pending while a local `switchboard approve <id>` or `switchboard deny <id>` decision arrives. If the MCP client disconnects during a wait, or a daemon starts for the repo with leftover pending requests, those requests are marked `stale` and cannot be approved later. Use `switchboard approvals --json`, `switchboard approve <id>`, and `switchboard deny <id>` to inspect and decide requests; add `--mandate <id> --include-children` to see a versioned `switchboard.approvals.v1` approval queue across a parent/child mandate tree. `switchboard install <codex|claude>` prints dry-run client config snippets for the daemon-backed MCP adapter; add `--write` to update project-scoped client config with a timestamped backup, or `--rollback <backup>` to restore one. `switchboard mandate create` persists a local task-scoped authority record bound to a repo, worktree, branch, agent role, profiles, lease, and optional `--allow-tool` / `--deny-tool` / `--require-approval-tool` namespaced tool patterns; pair approval gates with `--require-approval-reason`, `--require-approval-risk`, and `--require-approval-label` to show structured context in `mandate status` and `approvals`. `switchboard mandate child` creates a narrower child mandate from an active parent, inheriting parent denies and approval gates while requiring the child repo, worktree, branch, profiles, allowed tools, and lease to stay within parent scope. `switchboard mandate handoff <id>` closes a mandate with `completed`, `blocked`, or `cancelled` handoff state; parent mandates cannot hand off while child mandates remain open, and handoff refuses local readiness blockers by default; `--ignore-readiness` only skips softer local blockers such as pending approvals. `switchboard mandate report <id> --json` emits a versioned `switchboard.mandate-report.v1` tree report with parent/child state, readiness blockers, result rollups, related audit entries, and approval requests. `switchboard mandate escalate <id> --json` emits a versioned `switchboard.mandate-escalation.v1` local escalation plan with pending approvals, open child mandates, blocked/cancelled handoffs, suggested commands, and copy text. `switchboard mandate create --json` and `switchboard mandate child --json` also return an `mcpLaunch` payload with the schema version, mandate id, repo cwd, command, args, and additive command candidates a harness can use to launch `switchboard --cwd <repo> mcp --mandate <id>` even when the CLI is not on `PATH`. `switchboard mandate status --json` lists those records with `schemaVersion: "switchboard.mandate-status.v1"`. `switchboard serve` exposes configured stdio upstream profiles as one daemonless MCP server for debugging and CI, with the same `--mandate <id>` runtime context option; approval request creation is daemon-backed, so use `switchboard mcp --mandate <id>` for approval workflows. `switchboard logs --json` reads the local JSONL audit log through `schemaVersion: "switchboard.audit-log.v1"` and can filter entries with `--mandate <id>`. `switchboard daemon <status|start|ping|tools|stop>` manages the local daemon lifecycle foundation and daemon-side tool discovery. Provider integrations and a full approval broker come in later milestones.
