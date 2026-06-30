# Supabase Multiple Projects

Supabase support is currently a safety-template proof, not a full provider
integration or hosted auth flow.

Use `supabase-dev` when the repo has Supabase hints and the agent only needs
development-project inspection:

```bash
switchboard setup supabase-dev
switchboard doctor
switchboard presets check supabase-dev --profile supabase_dev --json
switchboard mandate create --from supabase-dev --json
switchboard mcp --mandate inspect-dev-db
```

The template defaults to the official local MCP server in read-only mode:

```text
npx -y @supabase/mcp-server-supabase@latest --read-only
```

Guided `setup` and `auth` reject obvious production, live, admin, root, and
`service_role`-looking credential values before storing secrets. This is still a
guardrail, not a hosted Supabase integration or sandbox.

For live dogfood, keep the server read-only until a mandate intentionally gates
writes, and add project scoping when the upstream server supports it. The goal
is to avoid an agent silently drifting from a development project into a
production database.

## Current Proof

`pnpm smoke:supabase-dev-dogfood` uses a Supabase-shaped fixture surface to
prove the authority boundary without live credentials:

- dev read/list/query/log tools are allowed
- arbitrary SQL and migrations require approval before upstream execution
- destructive/prod/admin/service-role/token-shaped tools are denied
- `switchboard run --mandate inspect-dev-db -- ...` injects only mounted
  Supabase `secretRef` env keys
- audit and mandate report evidence are tied to the mandate id

## Still Not Claimed

- No OAuth broker.
- No hosted Supabase integration.
- No production database safety guarantee.
- No proof yet against a live Supabase MCP tool surface.
- No claim that unrestricted shell, raw provider CLIs, browsers, or direct MCP
  routes are controlled unless they route through Switchboard.
