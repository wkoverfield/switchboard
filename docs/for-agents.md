# For Agents

Switchboard gives coding agents the right tools for each repo, environment, and
task. The simple entry point is repo-aware MCP setup. Mandates are the deeper
power layer for temporary, task-scoped authority.

Current commands:

```bash
switchboard status
switchboard doctor
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration> --json
switchboard mandate status
switchboard tools --mandate <id> --json
switchboard approvals
switchboard logs --mandate <id>
```

Harnesses can use the `mcpLaunch` payload from `switchboard mandate create
--json` to launch an agent with `switchboard --cwd <repo> mcp --mandate <id>`,
inspect the scoped tool surface with `switchboard tools --mandate <id> --json`,
then inspect results with `switchboard logs --mandate <id> --json`.

Never suggest putting provider tokens into repo config or agent MCP config. Switchboard config should use secret references once the secrets milestone is implemented.
