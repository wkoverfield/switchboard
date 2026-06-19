# Switchboard Competitive Landscape

Research date: 2026-06-18

## Bottom Line

There are several adjacent products. That is good: the category exists.

But Switchboard should not try to become a generic enterprise MCP gateway or a 1,000-app integration platform. The clearest opening is:

> The local-first MCP profile router for developers working across multiple accounts, projects, orgs, and environments.

Switchboard should integrate with registries/gateways where useful, but differentiate on:
- Local-first developer workflow.
- Profile/account/project/environment management.
- Repo-aware defaults.
- Namespaced tools.
- Prod/live safety.
- Audit logs.
- Works across Codex, Claude Code, Cursor, VS Code, etc.

## Products To Know

## Composio

Sources:
- https://composio.dev/
- https://composio.dev/mcp-gateway
- https://composio.dev/toolkits
- https://docs.composio.dev/reference/api-reference/mcp/postMcpServersCustom
- https://composio.dev/content/the-guide-to-mcp-i-never-had

What it is:
- AI agent integration platform.
- 1,000+ apps / 20,000+ tools according to their site.
- Managed auth, delegated access, tool execution.
- MCP servers and tool router.
- Can create custom MCP servers that integrate multiple apps/toolkits.
- Has enterprise MCP Gateway framing: governance, SSO, org-wide controls.
- Has SDK/framework content for Codex, Claude, Cursor, Vercel AI SDK, etc.

Why it matters:
- Composio is the most direct "broad integration/tool router" adjacent product.
- They are probably the thing people will ask about first.
- They cover the long-tail SaaS connector problem better than Switchboard should attempt early.

How Switchboard should relate:
- Do not compete head-on on "1,000 integrations."
- Do not make hosted OAuth aggregation the v1 core.
- Treat Composio as an optional upstream provider:

```bash
switchboard add composio personal --entity wilson
switchboard add composio findu --entity findu
```

Potential integration:
- Mount Composio's MCP/tool router behind Switchboard.
- Apply Switchboard profile namespaces and local policies on top.
- Use Composio for long-tail apps while Switchboard manages local workspace/profile routing and safety.

Differentiation:
- Composio is "connect agents to apps."
- Switchboard is "make every agent use the right account/project/environment safely from your repo."

Verdict:
- Integrate with it.
- Learn from it.
- Do not position as a Composio replacement.

## ToolHive / Stacklok

Sources:
- https://docs.stacklok.com/toolhive/
- https://github.com/stacklok/toolhive
- https://docs.stacklok.com/toolhive/guides-cli/
- https://stacklok.com/registry/

What it is:
- Open-source platform for running and managing MCP servers locally or in Kubernetes.
- Has CLI and desktop UI.
- Curated registry of trusted MCP servers.
- Handles deployment, management, security, telemetry, and fine-grained authorization policies.

Why it matters:
- This is close to "local MCP server management."
- It may overlap with Switchboard if Switchboard tries to be a general server runner/registry.

How Switchboard should relate:
- Do not start by being another MCP server installer.
- Potentially integrate with ToolHive as a runtime:

```bash
switchboard runtime toolhive
switchboard add toolhive github-prod
```

Differentiation:
- ToolHive manages MCP server lifecycle and security.
- Switchboard manages developer-facing profiles, namespaces, workspace defaults, and environment safety.

Verdict:
- Important adjacent.
- Potential integration/runtime.
- Avoid generic "run MCP servers locally" positioning.

## Smithery

Sources:
- https://smithery.ai/servers
- https://smithery.ai/docs/use/connect
- https://github.com/smithery-ai/cli
- https://workos.com/blog/smithery-ai

What it is:
- Registry/discovery/install hub for MCP servers.
- CLI for adding MCP servers.
- Hosted remote MCP option.
- Handles OAuth/tokens/sessions through API according to docs.

Why it matters:
- Smithery is discovery and installation.
- It is the Docker Hub-ish part of the MCP ecosystem.

How Switchboard should relate:
- Integrate as a source of MCP servers:

```bash
switchboard add smithery github
switchboard import smithery
```

- Do not compete as a registry.

Differentiation:
- Smithery helps you find/install/connect MCP servers.
- Switchboard helps you safely route multiple profiles of those servers per repo/environment.

Verdict:
- Integrate, do not compete.

## Docker MCP Gateway

Source:
- https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/

What it is:
- Docker's MCP Gateway runs MCP servers in isolated containers.
- Provides restricted privileges, network/resource controls, logging, call tracing, and governance.

Why it matters:
- Docker owns local developer infrastructure mindshare.
- If a user wants sandboxed local MCP execution, Docker can be part of the answer.

How Switchboard should relate:
- Potential runtime/backend for local MCP server execution.
- Good for untrusted/local servers.

Differentiation:
- Docker MCP Gateway is execution isolation and catalog/toolkit.
- Switchboard is profile/account/environment routing and safety UX.

Verdict:
- Watch closely.
- Integrate if possible.
- Avoid trying to out-Docker Docker on isolation.

## Microsoft MCP Gateway

Source:
- https://github.com/microsoft/mcp-gateway

What it is:
- Reverse proxy and management layer for MCP servers.
- Focused on scalable, session-aware routing, authorization, and lifecycle management in Kubernetes.

Why it matters:
- Validates "gateway" as infrastructure.
- More platform/Kubernetes than individual developer workflow.

How Switchboard should relate:
- Not an early competitor for the local developer wedge.
- Potential future enterprise compatibility target.

Verdict:
- Monitor.
- Do not chase this lane early.

## Agentic Community MCP Gateway & Registry

Sources:
- https://github.com/agentic-community/mcp-gateway-registry
- https://agentic-community.github.io/mcp-gateway-registry/
- https://builder.aws.com/content/30whXdNZoonuyycdgH9ylxrsXs4/centralizing-tooling-for-agentic-ai-how-to-deploy-the-mcp-gateway-and-registry-on-aws

What it is:
- Enterprise-ready gateway/registry.
- OAuth, dynamic discovery, unified access, Keycloak/Entra, RBAC, JWT token vending, audit logging.

Why it matters:
- Enterprise version of the same macro category.

How Switchboard should relate:
- Avoid enterprise-first governance messaging in v1.
- Let this validate the need for gateway/registry infrastructure.

Verdict:
- Category validation, not the initial lane.

## TrueFoundry / Gateway Registry Content

Sources:
- https://www.truefoundry.com/blog/what-is-mcp-gateway-registry
- https://www.truefoundry.com/es/blog/mcp-gateway-vs-proxy-vs-router

What it is:
- Education and enterprise platform content around gateways, registries, routers, and proxies.
- They frame gateway/registry as AI tool infrastructure and governance.

Why it matters:
- Useful vocabulary.
- Confirms distinction between proxy, router, gateway, and registry.

How Switchboard should relate:
- Use precise positioning:
  - Switchboard is a local router/profile manager first.
  - Not an enterprise registry first.

Verdict:
- Helpful framing source.

## Nango / Paragon / Merge / Truto / Scalekit / Arcade

Sources:
- https://www.scalekit.com/blog/composio-alternatives
- https://truto.one/blog/what-are-alternatives-to-composio-for-ai-agent-integrations-2026/
- https://www.merge.dev/blog/composio-alternatives

What they are:
- Integration/auth/API platforms.
- Often focused on SaaS product builders embedding integrations for their own users.
- Some are increasingly positioned around AI agents, auth, OAuth, and tool calling.

Why they matter:
- They solve deep integration/auth problems.
- They may be useful for future team/cloud Switchboard.

How Switchboard should relate:
- Do not build a full integration platform early.
- If Switchboard needs managed OAuth for long-tail SaaS later, evaluate using/partnering with these classes of tools.

Verdict:
- Not direct early competitors unless Switchboard becomes hosted auth/integrations.

## MetaMCP / MCPJungle / MCPX / Other Open-Source Gateways

Sources:
- https://glama.ai/mcp/servers/metatool-ai/mcp-server-metamcp
- https://www.reddit.com/r/mcp/comments/1m3bgxy/a_selfhosted_gateway_to_access_your_mcp_servers/
- https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026

What they are:
- Gateway/proxy/router/registry-style tools.
- Often focus on aggregating MCP servers, exposing one endpoint, or self-hosting.

Why they matter:
- The "one gateway for many MCP servers" pattern is active.
- Switchboard needs a sharper point of view.

How Switchboard should relate:
- Differentiate on profile/account/environment management and developer ergonomics.
- Avoid "we aggregate MCP servers too" as the core pitch.

Verdict:
- Watch and learn.

## Strategic Implications

### 1. Switchboard should be provider-agnostic but not connector-maximalist

Composio and others are fighting the 1,000-app connector battle.

Switchboard should fight the "right account/project/environment from the right repo" battle.

### 2. Switchboard should mount other systems

Switchboard should be able to mount:
- Native provider MCPs.
- Composio tool router.
- Smithery-hosted servers.
- ToolHive-managed local servers.
- Docker-isolated servers.
- Generic stdio/http/SSE MCP servers.

This makes Switchboard a profile/policy/router layer, not the only runtime.

### 3. The product needs a sharper primitive than "gateway"

"Gateway" sounds enterprise and crowded.

Better primitives:
- Profile
- Workspace
- Environment
- Account
- Namespace
- Policy
- Session

Better positioning:

> One MCP endpoint. Every account and environment. Safe by default.

### 4. The local-first wedge is still strong

Many products are cloud, registry, enterprise, or integration-platform oriented.

Switchboard can win early by feeling like:
- `gh`
- `vercel`
- `direnv`
- `1password` CLI
- `mise`

### 5. Composio integration may be a feature, not a threat

Possible future:

```bash
switchboard add composio sales --entity findu-sales
switchboard add composio personal --entity wilson
```

Then tools become:

```text
composio_sales_gmail_send_email
composio_personal_calendar_create_event
```

Switchboard adds:
- Workspace routing.
- Namespace clarity.
- Local policy.
- Logs.
- Environment/account separation.

## Recommended Positioning Update

Avoid:

> Switchboard is an MCP gateway.

Better:

> Switchboard is the local profile router for MCP.

Even better:

> One local MCP endpoint for every account, project, and environment.

## Recommended Initial Integrations

Build native support:
- Supabase
- Stripe
- PostHog
- Sentry

Support generic mounting:
- Any stdio MCP server.
- Any HTTP/SSE MCP server.

Add optional integrations:
- Composio as long-tail app provider.
- Smithery as registry/import source.
- ToolHive or Docker as runtime for local MCP servers.

## Recommended v0.1 Shape

Do not build a full connector platform.

Build:
- Local config.
- Profiles.
- Namespacing.
- Generic upstream MCP mounting.
- Provider presets for Supabase/Stripe/PostHog/Sentry.
- Workspace link.
- Read-only/live/prod safety.
- Audit logs.
- Client config generation.

This lets Switchboard work with existing MCPs and other platforms while still having a distinct reason to exist.

