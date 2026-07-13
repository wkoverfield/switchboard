# Audit Logs

Switchboard writes local JSONL audit logs for actions that exercise configured
profiles.

Current audited actions:

- `switchboard test <profile>`
- routed MCP tool calls through `switchboard mcp`
- routed MCP tool calls through the daemonless `switchboard serve` fallback

The log path follows XDG state conventions:

```text
$XDG_STATE_HOME/switchboard/logs/switchboard.jsonl
~/.local/state/switchboard/logs/switchboard.jsonl
```

Use:

```bash
switchboard logs
switchboard logs --json
switchboard logs --limit 50
switchboard logs --mandate fix-ci
switchboard mcp --mandate fix-ci
switchboard serve --mandate fix-ci
```

Audit entries include timestamps, action, status, profile, namespace, tool name,
upstream tool name, optional mandate id, duration, and redacted error text when present. Tool
arguments, tool results, prompts, provider credentials, and raw payloads are not
logged by this foundation slice. When MCP runtime commands run with
`--mandate <id>`, routed tool-call entries include that mandate id so
`switchboard logs --mandate <id>` can show the task-scoped activity trail.
Tool calls denied by mandate allow/deny patterns are logged as `tool_call`
entries with `status: "error"` and a redacted policy error message.
Tool calls blocked by mandate approval gates are also logged as `tool_call`
errors with the mandate id, tool name, approval request id, approval gate id,
and gate pattern.

Audit logs are local only. Switchboard does not upload audit logs automatically.

## Tamper evidence

Audit entries are hash-chained. Each entry carries two extra fields:

- `prevHash`: the `hash` of the previous entry, or the literal string
  `genesis` for the first chained entry.
- `hash`: `sha256:<hex>` over the entry's own JSON with the `hash` field
  removed.

Appends take a lockfile next to the log so concurrent writers (the daemon and
CLI commands) cannot fork the chain. Logs written before this change have no
hash fields; they are counted as legacy entries and the chain starts at the
first chained entry after them.

Verify the chain at any time:

```bash
switchboard audit verify
switchboard audit verify --json
```

Verification reports total, chained, and legacy entry counts, and the exact
line number and reason for every break. The command exits nonzero on failure.

What the chain detects: any in-place edit, insertion, deletion, or reordering
within the retained portion of the file. What it does not detect: truncating
the file back to a valid prefix, replacing the whole file and recomputing every
hash, or entries that were never written (audit writes are fail-open by design
so logging can never block a tool call). Signing and external anchoring, which
would close the first two gaps, are on the roadmap. The
[threat model](threat-model.md) covers this surface in full.
