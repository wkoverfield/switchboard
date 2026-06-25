# @switchboard-mcp/cli

Command-line interface for Switchboard.

Switchboard gives coding agents repo-aware MCP setup and task-scoped local
authority through mandates. The stable binary is:

```bash
switchboard
```

Start with the repository quickstart:

```bash
switchboard scan
switchboard setup github-ci
switchboard doctor
switchboard mandate create --from github-ci
switchboard mcp --mandate fix-ci
```

Project docs: https://github.com/woverfield/switchboard
