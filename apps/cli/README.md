# @switchboard-mcp/cli

Command-line interface for Switchboard.

Switchboard gives coding agents repo-aware MCP setup and task-scoped local
authority through mandates. The stable binary is:

```bash
switchboard
```

Start with the repository quickstart:

```bash
switchboard add github-ci --write
switchboard doctor
switchboard auth github-ci
switchboard mandate create --from github-ci
switchboard mcp --mandate fix-ci
```

Project docs: https://github.com/woverfield/switchboard
