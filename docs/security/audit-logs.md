# Audit Logs

Switchboard writes local JSONL audit logs for actions that exercise configured
profiles.

Current audited actions:

- `switchboard test <profile>`
- routed MCP tool calls through `switchboard serve`

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
```

Audit entries include timestamps, action, status, profile, namespace, tool name,
upstream tool name, duration, and redacted error text when present. Tool
arguments, tool results, prompts, provider credentials, and raw payloads are not
logged by this foundation slice.

Audit logs are local only. Switchboard does not upload audit logs automatically.
