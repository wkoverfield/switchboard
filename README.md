# Switchboard

Task-scoped authority for agentic software work.

Switchboard is evolving into the local mandate layer for coding agents: a way to give agents bounded jobs without giving them your whole life. The current foundation is a local-first MCP router for developers using Codex, Claude Code, Cursor, VS Code, and other MCP-compatible agents. It makes multi-account, multi-project, and dev/staging/prod tool access explicit, namespaced, policy-aware, and locally auditable.

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
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --allow-tool <pattern> --deny-tool <pattern>
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --require-approval-tool <pattern>
switchboard mandate status [id]
switchboard approvals
switchboard approve <approval-id>
switchboard deny <approval-id>
switchboard logs
switchboard logs --mandate <id>
switchboard daemon <status|start|ping|tools|stop>
switchboard mcp
switchboard mcp --mandate <id>
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

Start with `docs/install/quickstart.md`. `switchboard init` prints or writes a starter repo config, and `switchboard doctor` tells you the next command to run, including whether project Codex/Claude config is missing, stale, installed, or invalid. `switchboard test <profile>` checks that a configured stdio upstream starts and lists tools. `switchboard mcp` auto-starts the local daemon when needed and supports daemon-backed tool listing and routed tool calls; add `--mandate <id>` to validate an active mandate, mount that mandate's profiles, enforce its allow/deny/approval-required tool patterns, and attach the mandate id to tool-call audit entries. Approval-required daemon calls create local approval requests; use `switchboard approvals`, `switchboard approve <id>`, and `switchboard deny <id>` to inspect and decide them. `switchboard install <codex|claude>` prints dry-run client config snippets for the daemon-backed MCP adapter; add `--write` to update project-scoped client config with a timestamped backup, or `--rollback <backup>` to restore one. `switchboard mandate create` persists a local task-scoped authority record bound to a repo, worktree, branch, agent role, profiles, lease, and optional `--allow-tool` / `--deny-tool` / `--require-approval-tool` namespaced tool patterns. `switchboard mandate status` lists those records. `switchboard serve` exposes configured stdio upstream profiles as one daemonless MCP server for debugging and CI, with the same `--mandate <id>` runtime context option; approval request creation is daemon-backed, so use `switchboard mcp --mandate <id>` for approval workflows. `switchboard logs` reads the local JSONL audit log and can filter entries with `--mandate <id>`. `switchboard daemon <status|start|ping|tools|stop>` manages the local daemon lifecycle foundation and daemon-side tool discovery. Provider integrations, secrets, and a full approval broker come in later milestones.
