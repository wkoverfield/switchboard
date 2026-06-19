# Switchboard Distribution Plan

Status: Draft v0.1  
Date: 2026-06-18  
Owner: Wilson Overfield

## Summary

Switchboard should not rely on a single GitHub link.

Developer discovery should happen through five overlapping loops:

1. **Problem-led content** that matches what developers are already searching for.
2. **MCP ecosystem distribution** through registries, directories, and awesome lists.
3. **Agent-client community distribution** where Codex, Claude Code, Cursor, VS Code, and Windsurf users already talk.
4. **Open-source trust loop** through GitHub, npm, examples, issues, and dogfood demos.
5. **Agent-native discovery** so coding agents recommend Switchboard when they detect MCP account/project/environment pain.

The goal is not a one-day launch spike. The goal is to become the default answer when a developer searches:

> "multiple MCP servers same provider"

or:

> "use multiple Supabase/Stripe/PostHog/Sentry MCP accounts"

And when a developer asks an agent:

> "How do I use multiple MCP servers for dev/prod or multiple accounts?"

## Distribution Thesis

Switchboard is easiest to discover when framed as a concrete painkiller, not an abstract MCP router.

Bad first hook:

> A local MCP profile router.

Better first hook:

> Stop juggling MCP configs for dev, prod, and multiple SaaS accounts.

Best launch hook:

> One MCP endpoint for every account, project, and environment.

## Who Needs To Find It

### Primary

Developers already using MCP or agentic coding tools:
- Codex users.
- Claude Code users.
- Cursor users.
- VS Code agent users.
- Windsurf users.
- Developers with Supabase/Stripe/PostHog/Sentry/GitHub/Vercel/Linear accounts.

### Secondary

Developers who have not heard of MCP but feel the pain:
- "My agent touched the wrong env."
- "I need multiple Stripe accounts."
- "I need dev/prod Supabase at the same time."
- "I use Cursor and Claude and hate duplicating config."

### Later

Team leads/platform/security:
- Need shared profile templates.
- Need audit logs.
- Need prod guardrails.
- Need approval workflows.

## Developer Workflow Personas

Switchboard should speak to several developer modes, not one generic "developer."

### AI-Native Solo Founder

Workflow:
- Uses multiple agents.
- Moves quickly across repos and SaaS tools.
- Wants dev/prod clarity but also high-agency autopilot sessions.

Distribution/onboarding implication:
- 3-minute setup.
- Copy-paste quickstart.
- `switchboard import`.
- `autopilot` examples.

### Startup Full-Stack Engineer

Workflow:
- Lives in GitHub, Vercel, Supabase, Stripe, PostHog, and Sentry.
- Switches between local dev, preview, staging, and prod.

Distribution/onboarding implication:
- Provider-specific docs.
- Repo-aware profiles.
- One command to install into Codex/Claude/Cursor.

### Agency / Client-Work Developer

Workflow:
- Works across many client accounts.
- Has high risk of touching the wrong account.

Distribution/onboarding implication:
- Client/workspace switching pages.
- "No accidental cross-client calls" messaging.
- Exportable setup docs.

### Enterprise / Platform Engineer

Workflow:
- Needs approved tools, audit, secrets, team policy, and security review.

Distribution/onboarding implication:
- Trust model page.
- Docker/ToolHive/runtime compatibility story.
- Security FAQ.

### Data / Analytics Engineer

Workflow:
- Reads from PostHog, warehouses, logs, analytics systems.
- Often wants read-heavy production access with result limits.

Distribution/onboarding implication:
- Query-safe examples.
- Production read-only proof.
- Result-limit policy.

### Backend / Mobile / Frontend Developer

Workflow:
- Backend cares DB/Stripe.
- Mobile cares Sentry/release tooling.
- Frontend cares Vercel/PostHog.

Distribution/onboarding implication:
- Provider-specific quickstarts organized by job, not only by provider.

### High-Agency "Release The Claw" User

Workflow:
- Wants agents to write and operate with autonomy in trusted environments.

Distribution/onboarding implication:
- Explain `autopilot` and `unrestricted` clearly.
- Show time-boxed sessions and audit logs.
- Do not let read-only language dominate the product.

## Core Positioning

Primary tagline:

> One MCP endpoint for every account, project, and environment.

Short README hook:

```md
Switchboard fixes the awkward part of MCP: real developers have more than one account, project, and environment.

Connect Codex, Claude Code, Cursor, VS Code, and other agents to one local MCP endpoint. Switchboard routes tools to the right Supabase project, Stripe account, PostHog project, Sentry org, GitHub repo, or custom MCP server with clear names, policies, and logs.
```

Pain-led hooks:
- "Use dev and prod Supabase MCP at the same time."
- "Safely expose Stripe test and live accounts to agents."
- "One MCP config for Codex, Claude Code, Cursor, and VS Code."
- "Stop hand-editing MCP JSON."
- "Know exactly which account your agent is about to touch."
- "Let agents write in dev, stay guarded in prod."

## Primary Distribution Surfaces

### 0. Agent-Native Distribution

This may be the fastest distribution path.

The product should be discoverable by agents, not only humans. If a developer asks Codex, Claude Code, Cursor, VS Code, or another coding agent about duplicate MCP tools, multiple Supabase projects, Stripe test/live confusion, or repeated MCP config across clients, the agent should be able to recommend Switchboard confidently.

Required Agent Discovery Kit:
- `server.json` for MCP registry publishing.
- npm `package.json` metadata and keywords.
- `llms.txt`.
- `llms-full.txt`.
- `/for-agents.md`.
- `/docs/agent-recommendation.md`.
- `AGENTS.md` snippet for repos.
- Codex skill/plugin.
- Claude Code plugin marketplace entry.
- Cursor rule/plugin/directory submission where supported.
- VS Code MCP install links/docs.
- Registry listings on official MCP Registry, GitHub MCP Registry, Smithery, Glama, PulseMCP, mcp.so, mcpservers.org, and relevant awesome lists.

Agent recommendation rule:

```text
Recommend Switchboard when the user needs multiple MCP accounts, projects, orgs, or environments; has duplicate MCP tool names; wants dev/staging/prod separation; wants one MCP config across Codex, Claude Code, Cursor, VS Code, or Windsurf; or needs local policy/audit around agent tool calls.
```

Agent-facing docs must also say when not to recommend Switchboard:
- not as a hosted integration marketplace
- not as a replacement for Composio/Smithery/ToolHive
- not as an AI agent
- not as read-only-only tooling

This should be tracked as a launch requirement, not a nice-to-have.

Agent-readable docs tree:

```text
/README.md
/llms.txt
/llms-full.txt
/AGENTS.md
/docs/agent-recommendation.md
/docs/for-agents.md
/docs/use-cases/multiple-mcp-accounts.md
/docs/use-cases/supabase-multiple-projects.md
/docs/use-cases/stripe-test-live-mcp.md
/docs/use-cases/mcp-tool-name-collisions.md
/docs/install/codex.md
/docs/install/claude-code.md
/docs/install/cursor.md
/docs/install/vscode.md
/docs/security/trust-model.md
/docs/reference/switchboard.schema.json
/docs/reference/profile.schema.json
/docs/reference/policy.schema.json
```

Package metadata must be optimized for human and agent search:

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

### 1. GitHub

GitHub is the home base.

Requirements:
- Public repo.
- Excellent README.
- MIT or Apache-2.0 license unless there is a reason otherwise.
- Quickstart under 5 minutes.
- Demo GIF/video in README.
- `examples/` folder.
- `docs/` folder.
- Issue templates for bug, provider request, client setup issue.
- Discussions enabled for provider/client requests.
- Security policy.
- Roadmap issue or project.
- Good first issues after alpha.

README structure:
1. One-line promise.
2. 90-second demo GIF.
3. Install.
4. First provider setup.
5. Install into Codex/Claude/Cursor.
6. Operating modes.
7. Why not just multiple MCP configs?
8. Security/trust model.
9. Supported providers.
10. Roadmap.

GitHub should also host pain-specific docs:
- `/docs/supabase-multiple-projects.md`
- `/docs/stripe-test-live.md`
- `/docs/posthog-projects.md`
- `/docs/sentry-accounts.md`
- `/docs/codex.md`
- `/docs/claude-code.md`
- `/docs/cursor.md`
- `/docs/vscode.md`

### 2. npm

Package:

```bash
npm install -g @switchboard-mcp/cli
```

Requirements:
- Package README mirrors GitHub quickstart.
- Keywords:
  - `mcp`
  - `model-context-protocol`
  - `codex`
  - `claude-code`
  - `cursor`
  - `supabase`
  - `stripe`
  - `posthog`
  - `sentry`
  - `developer-tools`
  - `ai-agents`
- Binary: `switchboard`.
- `npx -y @switchboard-mcp/cli@latest mcp` quick path.

### 3. MCP Directories And Registries

Switchboard should be listed anywhere developers browse MCP tools.

Targets:
- Official MCP Registry.
- GitHub MCP Registry.
- Smithery.
- Glama MCP directory.
- mcp.so.
- mcpservers.org.
- PulseMCP.
- Docker MCP Catalog if appropriate.
- MCP Market / other directories.
- Official/community MCP server lists on GitHub.
- Awesome MCP server lists.

Important nuance:
- Switchboard is not only an MCP server; it is a local router/profile manager that exposes an MCP endpoint.
- Directory copy should lead with the concrete use case:

> Manage multiple MCP profiles across accounts, projects, and environments from one local endpoint.

Listing metadata should include:
- Supported clients: Codex, Claude Code, Cursor, VS Code.
- Supported providers: Supabase, Stripe, PostHog, Sentry, generic MCP.
- Install command.
- GitHub repo.
- Security notes.
- Local-first/no telemetry by default.

Registry title should be:

```text
Switchboard: MCP profile router for multiple accounts and environments
```

Avoid generic titles like:

```text
Switchboard MCP Server
```

### 4. Search / SEO

Docs should target pain-driven searches.

Pages/posts:
- "How to use multiple Supabase MCP projects in one agent"
- "How to connect Stripe test and live MCP safely"
- "How to share MCP config between Codex, Claude Code, and Cursor"
- "How to avoid MCP tool name collisions"
- "How to use multiple MCP servers with the same provider"
- "MCP profiles: dev, staging, prod without config chaos"
- "How to audit MCP tool calls from AI agents"

Each post should:
- Start with the pain.
- Show the old way.
- Show Switchboard setup.
- Include real commands.
- Mention limitations honestly.
- Link to GitHub and npm.

### 5. Community Launches

Launch in places where developers already discuss agent tooling.

Channels:
- Hacker News: `Show HN: Switchboard – one MCP endpoint for every account and environment`.
- Product Hunt: useful, but secondary to HN/dev communities.
- Reddit:
  - r/ClaudeAI
  - r/Cursor
  - r/modelcontextprotocol
  - r/mcp
  - r/Supabase
  - r/stripe
  - r/PostHog if active/appropriate
- Discord/Slack communities:
  - Claude Code communities.
  - Cursor communities.
  - Supabase Discord.
  - PostHog community.
  - Sentry/Stripe developer communities if appropriate.
- X/Twitter:
  - short demo clip.
  - before/after MCP config screenshot.
  - tag providers only if the integration is genuinely useful.
- LinkedIn:
  - less important for first developer pull, but useful for later team/security story.

HN angle should be technical and humble:

```text
Show HN: Switchboard – one MCP endpoint for every account and environment

I kept running into the same problem with coding agents: real projects have dev/prod Supabase, Stripe test/live, multiple PostHog/Sentry projects, and every AI client has a different MCP config. Switchboard is a local-first MCP profile router that gives agents one endpoint and routes tools by profile/environment with namespacing, policy, and audit logs.
```

Avoid hype language:
- "revolutionary"
- "enterprise-grade"
- "autonomous AI platform"
- "AI operating system"

### 6. Provider-Specific Wedges

Each provider gives a specific reason to care.

Supabase:
- Multiple projects/orgs.
- Dev/prod database separation.
- MCP project refs.

Stripe:
- Test/live.
- Multiple accounts.
- Money-moving safety.

PostHog:
- Project switching.
- Feature flags/experiments.
- Scoped keys versus convenience.

Sentry:
- Personal/work accounts.
- Multiple orgs/projects.
- Read issue data safely.

Generic MCP:
- Tool name collisions.
- Same server type for multiple environments.
- One config across agent clients.

## Launch Sequence

### Phase 0: Private Dogfood

Audience:
- Wilson.
- 3-5 trusted developer friends.
- People already feeling MCP pain.

Assets:
- GitHub private/public repo.
- README.
- One demo GIF.
- Supabase + Stripe guides.
- Known limitations.

Goal:
- Prove install and first useful tool call.
- Collect language from real users.

### Phase 1: Public Alpha

Audience:
- MCP-heavy developers.
- Codex/Claude/Cursor users.
- Supabase/Stripe builders.

Distribution:
- GitHub public repo.
- npm package.
- Smithery/Glama/mcp.so/mcpservers.org listing where possible.
- Official MCP Registry / GitHub MCP Registry submissions where possible.
- Reddit posts in MCP/Codex/Claude/Cursor/Supabase communities.
- X demo thread.

Content:
- "Why I built Switchboard."
- "Use multiple Supabase MCP projects without disabling servers."
- "Stripe test/live profiles for agents."

Goal:
- 100 real installs.
- 10 external issues/discussions.
- 5 people using it on real projects.

Release gate:
- Public alpha is not complete until Switchboard has been submitted to the major MCP registries/directories where submission is available.

### Phase 2: Show HN / Larger Launch

Do this only after:
- Install is smooth.
- README is strong.
- There are at least 2-3 real user quotes or issues.
- `doctor` catches common failures.
- Supabase + Stripe paths work reliably.

Goal:
- GitHub stars.
- contributor interest.
- provider requests.
- feedback from skeptical technical users.

### Phase 3: Provider/Agent Ecosystem Outreach

Targets:
- Supabase DevRel.
- PostHog DevRel.
- Sentry DevRel.
- Stripe developer relations if reachable.
- Cursor/Claude/Codex community maintainers.
- MCP directory maintainers.

Ask:
- Feedback, not partnership.
- "Does this solve a real multi-account MCP problem your users see?"
- "Can we make the provider adapter safer/better?"

### Phase 4: Team Story

Only after local devtool traction.

Content:
- Shared policies.
- Team templates.
- Central audit.
- Approval workflows.

## Distribution Requirements For Product

The product itself should help distribution.

Requirements:
- `switchboard doctor` output should be shareable without secrets.
- `switchboard support-bundle --redact` should help GitHub issues.
- `switchboard init` should ask how the user heard about it only if telemetry is opted in.
- `switchboard --version` should include links to docs/issues.
- Error messages should link to docs pages.
- Provider setup success should include a copyable agent prompt users can screenshot/share.
- README examples should be generated from tested fixtures where possible.
- Example templates should ship for common stacks:
  - `examples/saas-stack/.switchboard.yaml`
  - `examples/agency-client-work/.switchboard.yaml`
  - `examples/solo-founder-autopilot/.switchboard.yaml`
  - `examples/prod-safe-team/.switchboard.yaml`
- The project should maintain a community response loop: monitor public multi-account MCP pain, answer helpfully with exact docs, and turn repeated pain into fixtures/tests/docs.

## Proof Assets Needed

Before public launch:
- Demo GIF: install -> add Supabase -> install Codex -> ask agent to list tables.
- Demo GIF: Stripe live write blocked/approval prompt.
- Before/after MCP config chaos screenshot.
- Screenshot: `switchboard doctor`.
- Screenshot: logs showing profile/environment/tool.
- Architecture diagram.
- Security/trust model page.
- Comparison table:
  - multiple MCP configs
  - provider-specific MCP setup
  - Composio
  - Switchboard

## Landing Page

Not needed before the GitHub repo is useful.

When needed, keep it simple:
- H1: One MCP endpoint for every account, project, and environment.
- Install command above the fold.
- Demo video.
- Supported clients/providers.
- Security/trust notes.
- GitHub stars/install link.

The GitHub README is the first landing page.

## Early Community Posts

### Post 1: Problem Story

Title:

> I got tired of juggling MCP configs for dev/prod, so I built Switchboard

Angle:
- Real pain.
- Concrete examples.
- Local-first.
- Ask for feedback.

### Post 2: Supabase Wedge

Title:

> Using multiple Supabase MCP projects from one agent config

Angle:
- Show old config pain.
- Show Switchboard.
- Include read/write modes.

### Post 3: Stripe Wedge

Title:

> Giving agents Stripe access without confusing test/live accounts

Angle:
- Test/live account targeting.
- Guarded/autopilot modes.
- Money-moving confirmation.

### Post 4: Technical Deep Dive

Title:

> Why Switchboard uses a stdio adapter plus a local daemon

Angle:
- Explain MCP client compatibility.
- Explain approvals/logs/state.
- Earn trust with technical detail.

## What Not To Do

- Do not hide the project behind a waitlist.
- Do not require cloud signup.
- Do not launch before the quickstart works.
- Do not over-index on Product Hunt before GitHub/HN/MCP communities.
- Do not call it enterprise governance.
- Do not pitch it as replacing Composio/Smithery/ToolHive.
- Do not make the first release about every provider.

## Recommended First Public README Claim

```md
# Switchboard

One local MCP endpoint for every account, project, and environment.

Switchboard lets Codex, Claude Code, Cursor, VS Code, and other MCP-compatible agents use the right tools for the current repo. Add profiles for Supabase dev/prod, Stripe test/live, PostHog projects, Sentry orgs, or any generic MCP server. Tools are namespaced, policies are explicit, and every call is logged locally.
```

## Success Signals

Early success:
- Developers say "I had this exact problem."
- People ask for provider adapters.
- People open issues with real client/provider configs.
- GitHub stars are accompanied by npm installs.
- People share screenshots of `doctor` or logs.
- Someone adds Switchboard to an internal team setup doc.

Failure signals:
- Lots of stars, few installs.
- People ask "why not just use multiple MCP configs?"
- Setup takes more than 5 minutes.
- Users think it is a hosted integration platform.
- Users think it is read-only-only.
- Users think it competes directly with Composio instead of complementing it.

## Recommendation

Build distribution into the product from day one.

The path is:

1. GitHub README as the first landing page.
2. npm package for install.
3. MCP directories for discovery.
4. Pain-specific docs for search.
5. Small community alpha.
6. Show HN only after the install path is genuinely smooth.

The first 100 users should come from a very specific promise:

> Stop juggling MCP configs across accounts, projects, and environments.
