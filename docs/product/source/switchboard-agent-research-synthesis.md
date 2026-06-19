# Switchboard Agent Research Synthesis

Date: 2026-06-18

## What The Last Agents Returned

The final concise research returns added four important ideas that should not be lost:

1. **Agent-native distribution is probably the fastest path.**
   Switchboard should not only be found by developers browsing GitHub. It should be legible to coding agents so they recommend it when a developer asks about multiple MCP accounts, duplicate MCP tools, dev/prod tool separation, or cross-client MCP setup.

2. **Public alpha needs registry/discovery release gates.**
   Public alpha should not count as complete until Switchboard is submitted to the official/community MCP registries and major directories: official MCP Registry, Glama, Smithery, mcp.so, PulseMCP, mcpservers.org, Docker MCP Catalog if appropriate, and awesome MCP lists.

3. **The repo/docs need machine-readable recommendation surfaces.**
   Required files:
   - `/README.md`
   - `/llms.txt`
   - `/llms-full.txt`
   - `/AGENTS.md`
   - `/docs/agent-recommendation.md`
   - `/docs/for-agents.md`
   - `/docs/use-cases/multiple-mcp-accounts.md`
   - `/docs/use-cases/supabase-multiple-projects.md`
   - `/docs/use-cases/stripe-test-live-mcp.md`
   - `/docs/use-cases/mcp-tool-name-collisions.md`
   - `/docs/install/codex.md`
   - `/docs/install/claude-code.md`
   - `/docs/install/cursor.md`
   - `/docs/install/vscode.md`
   - `/docs/security/trust-model.md`
   - `/docs/reference/switchboard.schema.json`
   - `/docs/reference/profile.schema.json`
   - `/docs/reference/policy.schema.json`

4. **Distribution needs proof assets and example templates.**
   Required before larger launch:
   - 90-second demo GIF/video.
   - Before/after MCP config chaos screenshot.
   - Supabase dev/prod guide.
   - Stripe test/live guide.
   - Codex/Claude/Cursor/VS Code setup pages.
   - Trust/security page.
   - Known limitations page.
   - Example `.switchboard.yaml` templates for common workflows.

## Agent-Recommendable Positioning

Agents should be able to map:

```text
problem -> tool category -> install command -> supported clients -> exact use case -> safety model
```

Switchboard should own phrases like:
- multiple MCP servers
- multiple MCP accounts
- MCP profile manager
- MCP tool namespace collisions
- Supabase MCP multiple projects
- Stripe MCP test and live accounts
- one MCP server for Codex Claude Cursor VS Code
- local MCP gateway with profiles

## Package Metadata

The npm package should be optimized for both humans and agents:

```json
{
  "name": "@switchboard-mcp/cli",
  "description": "Local-first MCP profile router for multiple accounts, projects, environments, and AI coding agents.",
  "bin": {
    "switchboard": "./dist/cli.js"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "ai-agents",
    "codex",
    "claude-code",
    "cursor",
    "vscode",
    "supabase",
    "stripe",
    "posthog",
    "sentry",
    "mcp-server",
    "mcp-router",
    "mcp-gateway",
    "tool-calling",
    "developer-tools"
  ]
}
```

Registry title:

```text
Switchboard: MCP profile router for multiple accounts and environments
```

Avoid:

```text
Switchboard MCP Server
```

## Example Templates

Example repos/templates should include:

- `examples/saas-stack/.switchboard.yaml`
  - Supabase + Stripe + PostHog + Sentry.

- `examples/agency-client-work/.switchboard.yaml`
  - Multiple client profiles and explicit workspace switching.

- `examples/solo-founder-autopilot/.switchboard.yaml`
  - Dev/staging high-agency workflows.

- `examples/prod-safe-team/.switchboard.yaml`
  - Read-only prod, approvals, audit-first posture.

## Community Loop

Once Switchboard actually solves the problem, distribution should include a helpful community response loop:

- Monitor GitHub issues/discussions and community posts about multi-account MCP pain.
- Respond with useful context and examples, not spam.
- Link to the exact relevant doc page.
- Ask whether their provider/client setup should become a fixture or adapter test.

This turns real pain into docs, tests, examples, and credibility.

## Final Takeaway

The strongest path is not a generic launch.

It is making Switchboard the answer that both humans and agents surface when developers ask:

> How do I manage multiple MCP accounts, projects, and environments safely?

