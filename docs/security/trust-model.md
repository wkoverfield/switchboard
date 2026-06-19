# Trust Model

Switchboard is local-first. Remote telemetry is planned to be opt-in only. Provider secrets should not be stored in repo config or agent MCP config.

Switchboard now writes local JSONL audit logs for profile tests and routed tool calls. Logs are stored under XDG state paths and are never uploaded automatically.

Milestone 0/1 validates config and detects namespace collisions. Stronger enforcement, secrets, approvals, and daemon socket security are later milestones.
