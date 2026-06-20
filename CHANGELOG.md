# Changelog

## Unreleased

- Scaffolded the TypeScript pnpm workspace.
- Added `@switchboard-mcp/cli` with the `switchboard` binary.
- Added config/profile schemas, config precedence, namespace normalization, and collision detection.
- Added `switchboard status` and `switchboard doctor`.
- Started generic stdio MCP upstream mounting with namespaced tool discovery and routed calls.
- Added a stdio MCP front door through `switchboard serve`.
- Added an end-to-end smoke check for a real `switchboard serve` MCP session.
- Added `switchboard test <profile>` for validating one configured stdio upstream.
- Added `switchboard install <codex|claude>` dry-run snippets for client MCP config.
- Added local JSONL audit logging for profile tests and routed tool calls.
- Added `switchboard logs` for reading local audit entries.
- Added `switchboard init` for starter repo config previews and safe writes.
- Added doctor next-step guidance for first-run onboarding.
- Added `switchboard daemon status/start/stop` lifecycle foundation.
- Added daemon socket ping protocol and `switchboard daemon ping`.
- Added daemon-side namespaced tool discovery and `switchboard daemon tools`.
- Added initial daemon-backed MCP adapter tool listing through `switchboard mcp`.
- Added daemon-backed MCP tool-call forwarding with audit logging.
- Added daemon auto-start for `switchboard mcp`.
- Switched Codex and Claude install snippets to the daemon-backed `switchboard mcp` adapter.
- Added project-scoped `switchboard install <codex|claude> --write` installers with timestamped backups and `--rollback`.
- Added project Codex/Claude client config detection to `switchboard doctor`.
- Added existing project MCP server name discovery to `switchboard doctor`.
- Added mandate strategy docs and updated the roadmap toward task-scoped authority for coding agents.
- Added local mandate persistence plus `switchboard mandate create`, `switchboard mandate status`, and `switchboard logs --mandate`.
- Added mandate-scoped MCP runtime context through `switchboard mcp --mandate` and `switchboard serve --mandate`.
- Added mandate allow/deny tool patterns with denied-call audit entries.
- Reframed product docs around Switchboard as the local mandate layer for coding agents, with provider presets deferred behind mandate-aware policy, approvals, audit, and secrets.
- Added mandate approval-required tool patterns with conservative runtime blocking and audit gate metadata.
- Added local approval request storage plus `switchboard approvals`, `switchboard approve`, and `switchboard deny`.
- Added approval lifecycle polish: expired-status filtering, human next-action hints, and retry guidance in approval-required daemon errors.
