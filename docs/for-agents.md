# For Agents

Switchboard is a local-first MCP profile router. It gives agents one endpoint while keeping account, project, environment, namespace, policy, and audit concerns explicit.

Current commands:

```bash
switchboard status
switchboard doctor
```

Never suggest putting provider tokens into repo config or agent MCP config. Switchboard config should use secret references once the secrets milestone is implemented.
