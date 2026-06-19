# Switchboard

One local MCP endpoint for every account, project, and environment.

Switchboard is a local-first MCP profile router for developers using Codex, Claude Code, Cursor, VS Code, and other MCP-compatible agents. It is designed to make multi-account, multi-project, and dev/staging/prod tool access explicit, namespaced, policy-aware, and locally auditable.

This repository is in Milestone 4 foundation work. It currently ships the TypeScript workspace, CLI shell, config/profile schemas, namespace normalization, collision detection, `switchboard status`, `switchboard doctor`, generic stdio MCP upstream mounting, namespaced tool routing, a stdio MCP front door, client config dry-run snippets, local audit logs, daemon lifecycle commands, daemon-side tool discovery, a daemon-backed MCP adapter for tool listing and routed calls, and end-to-end MCP smoke checks.

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
switchboard logs
switchboard daemon <status|start|ping|tools|stop>
switchboard mcp
switchboard serve
```

## Product Roadmap

The current working roadmap lives at `docs/product/roadmap.md`. Original
planning-thread source docs are preserved in `docs/product/source/`.

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

Start with `docs/install/quickstart.md`. `switchboard init` prints or writes a starter repo config, and `switchboard doctor` tells you the next command to run. `switchboard test <profile>` checks that a configured stdio upstream starts and lists tools. `switchboard serve` exposes configured stdio upstream profiles as one MCP server over stdio and remains the installer target until daemon auto-start lands. `switchboard mcp` exposes the daemon-backed adapter and supports daemon-backed tool listing and routed tool calls when the daemon is already running. `switchboard install <codex|claude>` prints dry-run client config snippets for the stdio front door. `switchboard logs` reads the local JSONL audit log. `switchboard daemon <status|start|ping|tools|stop>` manages the local daemon lifecycle foundation and daemon-side tool discovery. Provider integrations, secrets, policy enforcement, and write-to-config installers come in later milestones.
