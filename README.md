# Switchboard

Repo-aware MCP setup and task-scoped authority for agentic software work.

Switchboard gives coding agents the right tools for each repo, environment, and task. The simple entry point is local-first MCP setup for developers using Codex, Claude Code, Cursor, VS Code, and other MCP-compatible agents: project-scoped config, correct accounts/projects per repo, dev/prod separation, fewer duplicate MCP configs, safer defaults, and local auditability. Codex and Claude Code are shipped installer targets today; Cursor and VS Code remain planned surfaces.

The deeper power layer is mandates: temporary, task-scoped authority that lets agents do bounded jobs without inheriting a human's whole tool surface. Mandates stay optional for simple setup, but they give advanced users and external harnesses a way to bind profiles, tools, leases, approvals, and audit logs to a specific task.

This repository is in foundation work for the local mandate layer. It currently ships the TypeScript workspace, CLI shell, config/profile schemas, namespace normalization, collision detection, `switchboard status`, `switchboard doctor`, generic stdio MCP upstream mounting, namespaced tool routing, a stdio MCP front door, client config dry-run and write-mode installers for Codex and Claude Code, project client config and existing MCP server detection in doctor, local audit logs, daemon lifecycle commands, daemon-side tool discovery, a daemon-backed MCP adapter for tool listing and routed calls, local mandate creation/status, mandate-scoped MCP runtime context, mandate allow/deny tool policy, and end-to-end MCP smoke checks.

## Install From Source

```bash
pnpm install
pnpm build
pnpm --filter @switchboard-mcp/cli switchboard --help
pnpm smoke:profile-test
pnpm smoke:mcp-serve-session
```

## Current Commands

```bash
switchboard --help
switchboard init
switchboard status
switchboard doctor
switchboard test <profile>
switchboard install <codex|claude>
switchboard install <codex|claude> --write
switchboard install <codex|claude> --rollback <backup>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --allow-tool <pattern> --deny-tool <pattern>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --require-approval-tool <pattern> --require-approval-reason <reason>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --require-approval-tool <pattern> --require-approval-risk <risk> --require-approval-label <label>
switchboard mandate status [id]
switchboard tools
switchboard tools --mandate <id> --json
switchboard approvals
switchboard approvals --status <pending|approved|denied|stale|expired>
switchboard approve <approval-id>
switchboard deny <approval-id>
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

Start with `docs/install/quickstart.md`. `switchboard init` prints or writes a starter repo config, and `switchboard doctor` tells you the next command to run, including whether project Codex/Claude config is missing, stale, installed, or invalid. `switchboard test <profile>` checks that a configured stdio upstream starts and lists tools. `switchboard tools --mandate <id> --json` gives scripts and harnesses the repo/mandate-scoped tool surface, including approval-gated tool metadata, without launching an agent client; the response is tagged with `schemaVersion: "switchboard.tool-surface.v1"`. `switchboard mcp` auto-starts the local daemon when needed and supports daemon-backed tool listing and routed tool calls; add `--mandate <id>` to validate an active mandate, mount that mandate's profiles, enforce its allow/deny/approval-required tool patterns, and attach the mandate id to tool-call audit entries. Approval-required tools remain discoverable with `_meta.switchboard.approvalRequired`, but execution still creates a local approval request and returns retry instructions by default; when the connected MCP client advertises form elicitation support, Switchboard can ask for an in-client approve/deny decision, persist it through the same local approval store, and retry approved calls. Add `--approval-wait 30s` or another duration up to `10m` to keep gated tool calls pending while a local `switchboard approve <id>` or `switchboard deny <id>` decision arrives. If the MCP client disconnects during a wait, or a daemon starts for the repo with leftover pending requests, those requests are marked `stale` and cannot be approved later. Use `switchboard approvals`, `switchboard approve <id>`, and `switchboard deny <id>` to inspect and decide requests. `switchboard install <codex|claude>` prints dry-run client config snippets for the daemon-backed MCP adapter; add `--write` to update project-scoped client config with a timestamped backup, or `--rollback <backup>` to restore one. `switchboard mandate create` persists a local task-scoped authority record bound to a repo, worktree, branch, agent role, profiles, lease, and optional `--allow-tool` / `--deny-tool` / `--require-approval-tool` namespaced tool patterns; pair approval gates with `--require-approval-reason`, `--require-approval-risk`, and `--require-approval-label` to show structured context in `mandate status` and `approvals`. `switchboard mandate create --json` also returns an `mcpLaunch` payload with the schema version, mandate id, repo cwd, command, and args a harness can use to launch `switchboard --cwd <repo> mcp --mandate <id>`. `switchboard mandate status --json` lists those records with `schemaVersion: "switchboard.mandate-status.v1"`. `switchboard serve` exposes configured stdio upstream profiles as one daemonless MCP server for debugging and CI, with the same `--mandate <id>` runtime context option; approval request creation is daemon-backed, so use `switchboard mcp --mandate <id>` for approval workflows. `switchboard logs` reads the local JSONL audit log and can filter entries with `--mandate <id>`. `switchboard daemon <status|start|ping|tools|stop>` manages the local daemon lifecycle foundation and daemon-side tool discovery. Provider integrations, secrets, and a full approval broker come in later milestones.
