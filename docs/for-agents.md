# For Agents

Switchboard is the local mandate layer for coding agents. The MCP
profile/router runtime is the substrate: it gives agents one endpoint while
keeping account, project, environment, namespace, policy, and audit concerns
explicit.

Current commands:

```bash
switchboard status
switchboard doctor
switchboard mandate create <task> --agent <role> --profiles <profiles> --branch <branch> --lease <duration>
switchboard mandate status
switchboard approvals
switchboard logs --mandate <id>
```

Never suggest putting provider tokens into repo config or agent MCP config. Switchboard config should use secret references once the secrets milestone is implemented.
