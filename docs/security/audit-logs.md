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
errors with the mandate id, tool name, approval gate id, and gate pattern.

Audit logs are local only. Switchboard does not upload audit logs automatically.
