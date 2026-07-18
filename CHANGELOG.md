# Changelog

## Unreleased

- **DEFAULT BEHAVIOR CHANGE: the ambient seatbelt is on by default.** Routed MCP calls are now checked against a small catastrophe denylist on every call, with no pass bound and as an un-removable floor under an active pass. Existing users upgrading see new denials ONLY on catastrophe-class calls: production deploys (`deploy ... --prod`, `vercel --prod`, `convex deploy`, `deploy_prod`-shaped tools), live-mode payment keys (`sk_live_`/`rk_live_`, `stripe --live`), DNS and domain mutations (`vercel dns add/rm/import`, `vercel domains add/rm/buy/move/transfer-in`, Route 53 `change-resource-record-sets`), and force-pushes to `main`/`master`. Everything else is untouched: preview deploys, Convex dev deploys, Stripe test-mode calls, dev-database teardown, and force-pushes to feature branches do not trip. A trip denies immediately with the pattern name, the reason, and the exact `switchboard approve` command; an approval request is queued, and after approval a retry of the same call succeeds (the approval covers that pattern and tool until the pass expires, or for 15 minutes with no pass). Opt out with `seatbelt: off` in `~/.config/switchboard/config.yaml` or `--no-seatbelt` on `switchboard mcp`/`switchboard serve`; extend or trim the list as data under `policies.default.seatbelt` (`add`/`remove`). The seatbelt reads only the machine-level global config, so a repo `.switchboard.yaml` cannot disable it. Full details in `docs/security/seatbelt.md`.
- Added `switchboard hooks install claude` / `switchboard hooks uninstall claude`: a PreToolUse Bash tripwire in user-scope Claude Code settings (`~/.claude/settings.json`) that denies catastrophe-class shell commands using the same seatbelt denylist, read from the global config at hook runtime. Install merges with a timestamped backup and never touches other settings; uninstall removes exactly what was installed, restoring the pre-install content. Hook denials queue the same approvable retry and land in the audit log as `hook_denial` entries. `switchboard setup` now installs the hook by default (the previously reserved hooks step), still respecting a recorded `--no-hooks` opt-out, and `setup --rollback` removes it. The hook is harness-level, not OS enforcement.
- Added `switchboard audit append`: append one event (action, status, tool, command, reason, source) to the local hash-chained audit log, so harness-level hooks and scripts can land denials in the same stream the daemon writes. CLI approval decisions (`switchboard approve`/`deny`) are now recorded as `approval_decision` audit entries.
- Daemon hygiene: a daemon with no requests for 60 minutes now exits cleanly and removes its own state and socket (`SWITCHBOARD_DAEMON_IDLE_TIMEOUT_MS` overrides the window for tests). `switchboard doctor` gained a `daemon-hygiene` check that reports orphaned daemons: a recorded repo path that no longer exists, a daemon older than 7 days, or a `daemon run` process whose runtime directory was deleted, with cleanup guidance.

## 0.2.1

- Added `switchboard setup` (no preset): one machine-level command that scans, consolidates the current repo's MCP client config via import (skippable with `--skip-import`), lists the exact `switchboard secrets set <ref>` commands for every configured `secretRef` without ever reading token values, writes the user-scoped Codex server entry, prints the one-time `claude mcp add --scope user` command, and initializes `~/.config/switchboard/config.yaml` (respecting `XDG_CONFIG_HOME`) with an empty machine-level `policies.default` stanza. `--json` runs with zero prompts; human mode asks a single Enter-accepts confirmation on a TTY. Re-runs repair instead of duplicating and never re-back-up unchanged files. `switchboard setup --rollback` reverses every write from a manifest under `$XDG_STATE_HOME/switchboard/setup/`, restoring backups byte-for-byte and removing files setup created; any file rollback restores or removes whose content changed after setup is snapshotted first, so rollback never destroys later edits. Writes are recorded in the manifest as they happen with atomic replacement, a corrupt manifest fails the run closed and is quarantined to `manifest.json.corrupt-<timestamp>`, and concurrent runs are serialized by a lock file (a second run fails fast). Machine mode rejects provider preset flags and preset mode rejects machine flags instead of silently ignoring them. `--no-hooks` records an agent-hook opt-out in the global config; hook installation itself is reserved for a later release and installs nothing today. `switchboard setup <preset>` keeps its existing guided provider behavior.

- Gave scan, import, doctor, audit, and manifest read-only visibility of user-scoped client configs (`~/.codex/config.toml`, `~/.claude.json`). Direct user-level MCP servers surface as bypass findings with ids of the form `<client>:user:<server>` (project-scope ids are unchanged), acceptable via `--accept-direct`; a user-scoped Switchboard entry counts the repo as routed. Import cleanup and profile import never touch user-level files. Scan JSON adds an additive `scope` field ("project" or "user") to each client row and may include user-scope rows; the schema version is unchanged.
- Made `switchboard install codex --scope user --write` manage `~/.codex/config.toml` directly (or `$CODEX_HOME/config.toml`): merge-with-backup, `--rollback`, and a dry run that prints the exact TOML. The user-scoped entry launches `switchboard mcp` with no `--cwd`, so one entry serves every repo; inspection reports a pinned `cwd` key in a user-scope entry as stale. Claude Code user scope stays print-only (`~/.claude.json` is owned by `claude mcp add --scope user`), and `install claude --scope user --write` now fails with that guidance.

## 0.2.0

- Hardened the audit log against truncation: each entry now carries a monotonic `seq` (its absolute line position), and every write updates an atomically-replaced head marker (`switchboard.jsonl.head`) recording the tip `{seq, hash}`. `switchboard audit verify` compares the log against the marker and reports tail-truncation ("ends at N entries but the head marker records M") instead of accepting a truncated prefix as "Chain: OK". A removed marker alongside sequenced entries is flagged too. The head marker raises the bar to tampering with two files consistently; it is not an external anchor (deleting both still evades detection), which stays roadmap.
- Made audit-write failures loud instead of silent: `safeAuditLog` with no error handler now prints a `WARNING audit log write failed` line to stderr. Writes remain fail-open (logging never blocks a tool call), but a dropped entry is no longer invisible.
- Added opt-in strict mode: set `enforcement: strict` in `.switchboard.yaml`, or pass `--strict` to `switchboard mcp` / `switchboard serve`, and a connection with no bound pass is denied instead of served ungoverned. The routed `tools/list` is empty and every call is rejected with "no active pass; grant one with switchboard grant", on both the daemon and daemonless serve paths. Strict is off by default (the flag only ever strengthens the config), so unconfigured installs keep their current behavior.
- Added a full STRIDE threat model at `docs/security/threat-model.md`: trust boundaries, what enforcement binds vs what it cannot, revocation semantics, daemon socket assumptions, secrets backends, and the audit-log threat surface, ending in an accepted-risks list. `trust-model.md` is now a short posture summary that points at it.
- Made the audit log tamper-evident: entries are hash-chained (`prevHash`/`hash` fields), appends are serialized with a lockfile, and `switchboard audit verify` checks the chain and reports exactly where it breaks. Pre-existing entries are treated as legacy and keep working.
- Added `switchboard dashboard`: a local, read-only web dashboard (127.0.0.1 only) showing live passes, pending approvals, denials, and the audit stream.
- Re-cut the hero demo (`examples/switchboard.tape`): the climax is now a live out-of-scope DENIED call through the real MCP front door, with an approval-gated call and `switchboard audit verify` in the story. Added `demo-agent.mjs`, a real MCP client that plays the agent.
- Added a static landing page and docs site under `site/` (narrative anchored on the July 28, 2026 MCP spec revision and the ~8.5% OAuth / ~18% scoping adoption gap, with citations), rendered from the repo's own markdown.
- Added `@switchboard-mcp/docs-mcp`: the official MCP server for the Switchboard docs (`list_docs`, `read_doc`, `search_docs`), bundled and offline.
- Rewrote `llms.txt` and `llms-full.txt` to match the shipped product (they described a pre-daemon milestone) and added honesty constraints for agents.
- Added `docs/product/public-roadmap.md`: the honest shipped / next / later split. Org model, richer policy engine, enterprise surface, and daemon socket hardening are roadmap entries, deliberately not built.

## 0.1.6

- Added the `mcpName` field to the published package so the official MCP registry can validate npm ownership.

## 0.1.5

- Multiplexed the daemon: one daemon serves many repos concurrently, routing each request by its own cwd. Removes the single-repo "daemon is running for X" collision.
- Auto-bind the live pass by repo and branch when a request has no `--mandate`, so `switchboard grant` in a repo scopes any agent there automatically.
- Added `switchboard install <client> --scope user`: one trusted Switchboard server for every repo, with no per-repo install or per-project trust prompt.
- Surfaced the user-scope option in `install` output and the README.
- Added `server.json` and ownership markers for the official MCP registry.

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
- Added bounded approval waits for daemon-backed mandate MCP calls with `switchboard mcp --approval-wait <duration>`.
- Added stale approval request status for disconnected approval waits.
- Added daemon-start invalidation for leftover pending approval requests.
- Added approval gate reason metadata for mandate creation and approval requests.
