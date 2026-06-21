# For Agents

Switchboard gives coding agents the right tools for each repo, environment, and
task. The simple entry point is repo-aware MCP setup. Mandates are the deeper
power layer for temporary, task-scoped authority.

Current commands:

```bash
switchboard status
switchboard doctor
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json
switchboard mandate child <task> --parent <id> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json
switchboard mandate handoff <id> --state completed --summary <summary> --json
switchboard mandate report <id> --json
switchboard mandate status
switchboard tools --mandate <id> --json
switchboard approvals --mandate <id> --include-children --json
switchboard logs --mandate <id>
```

Harnesses can use the `mcpLaunch` payload from `switchboard mandate create
--json` to launch an agent with `switchboard --cwd <repo> mcp --mandate <id>`,
inspect mandate state with `switchboard mandate status <id> --json`, inspect
the scoped tool surface with `switchboard tools --mandate <id> --json`, then
close work with `switchboard mandate handoff <id> --state completed --json`.
Use `switchboard mandate report <id> --json` for parent/child handoff state,
readiness blockers, result rollups, and related audit entries. Use
`switchboard approvals --mandate <id> --include-children --json` for approval
queues across a lead/worker mandate tree. Mandate status JSON is versioned as
`switchboard.mandate-status.v1`, mandate report JSON is versioned as
`switchboard.mandate-report.v1`, approval request JSON is versioned as
`switchboard.approvals.v1`, and tool surface JSON is versioned as
`switchboard.tool-surface.v1`.

Never suggest putting provider tokens into repo config or agent MCP config. Switchboard config should use secret references once the secrets milestone is implemented.
