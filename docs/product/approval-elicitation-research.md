# Approval Elicitation Research

Last updated: 2026-06-20

## Question

How should Switchboard surface mandate approval gates inside coding-agent
clients without overbuilding a client-specific approval broker?

## Sources Checked

- MCP elicitation specification:
  https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- MCP tools specification:
  https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Claude Code MCP docs:
  https://code.claude.com/docs/en/mcp
- Claude Code hooks reference:
  https://code.claude.com/docs/en/hooks
- Codex agent approvals and security:
  https://developers.openai.com/codex/agent-approvals-security
- Codex advanced configuration:
  https://developers.openai.com/codex/config-advanced

## Findings

MCP has a standard client feature for elicitation. A server can send an
`elicitation/create` request during another MCP interaction when the client
declares the `elicitation` capability. The checked 2025-11-25 MCP spec separates
form mode from URL mode. Form mode is for structured non-secret input; URL mode
is for sensitive or out-of-band interactions. The spec is explicit that form mode
must not be used for passwords, API keys, access tokens, payment credentials, or
similar secrets.

MCP tools remain model-controlled. The tools spec recommends a human-in-the-loop
user interaction model for tool invocations, but the protocol does not mandate a
single UI. That means Switchboard cannot assume that every client will display
the same prompt or support nested server-to-client elicitation.

Claude Code documents MCP elicitation support. Its hooks system includes
`Elicitation` and `ElicitationResult` events. By default Claude Code can show an
interactive dialog when an MCP server requests user input during a tool call,
and hooks can respond programmatically or block the result before it returns to
the server.

Codex documents approval behavior for actions with side effects, including app
and MCP tool calls that advertise destructive or side-effecting annotations.
This is useful for Codex-native safety prompts, but it is not the same as
Switchboard mandate approval state. Switchboard should not assume Codex will
translate local mandate approval requests into Switchboard approval decisions
without explicit protocol support or a documented integration path.

Codex advanced configuration also documents granular approval policy categories,
including `mcp_elicitations`. That means client capability detection is
necessary but not sufficient: even if Codex supports MCP elicitation at the
protocol level, local policy may allow the prompt to surface or may fail it
closed.

## Product Interpretation

Switchboard currently has a conservative cross-client approval fallback:

- approval-gated mandate calls create local approval requests
- the MCP call returns retry instructions by default
- `switchboard mcp --approval-wait <duration>` can wait for a local approve/deny
  decision
- pending requests become stale when the waiting client disconnects or the daemon
  restarts

That fallback should remain the baseline because it works across Codex, Claude
Code, and any stdio MCP client that can display tool errors.

Native elicitation should be an enhancement, not a replacement. The daemon/MCP
runtime can only use MCP elicitation when the client advertised an elicitation
capability during initialization. If the client does not advertise support, or if
the elicitation is declined/cancelled, Switchboard should fall back to the
existing approval request store and retry instructions.

Approval elicitation should ask for a decision, not secrets. The form should
include mandate id, task, repo, branch, agent role, tool name, gate id, risk,
labels, reason, and expiry. MCP response actions are `accept`, `decline`, or
`cancel`; a Switchboard approval decision should be a required form field inside
`content` only when the MCP action is `accept`. That decision field should be a
narrow enum such as `approve` or `deny`, with an optional decision reason. The
form must not ask for tokens, credentials, API keys, or provider secrets.

URL mode elicitation is not the right next step for mandate approvals. It may be
useful later for external OAuth or provider authorization flows, but those are
closer to the secrets/provider milestones. For now, mandate approval is local
authority control, so form-mode elicitation plus the existing CLI fallback is the
right shape.

## Recommended Next Build Slice

Build a minimal MCP form-mode approval elicitation spike:

- track client initialization capabilities in the stdio MCP adapter/session
- when a mandate approval gate blocks a tool call and the client supports form
  elicitation, send `elicitation/create`
- include only non-secret approval context:
  - mandate id
  - task
  - repo path
  - branch
  - agent role
  - tool name
  - gate id and pattern
  - gate risk and labels
  - gate reason
  - approval request id
  - expiry
- handle MCP response actions according to spec:
  - `accept` with `content.decision = "approve"` approves through the existing
    approval request store
  - `accept` with `content.decision = "deny"` denies through the existing store
  - `decline` or `cancel` do not create an approval decision and fall back to the
    current retry/stale behavior
- persist approve/deny decisions through the existing approval request store
- preserve current `--approval-wait` and retry-instructions behavior when
  elicitation is unavailable, declined, cancelled, or errors
- audit the elicitation attempt and resulting decision state

Do not build:

- client-specific Claude hook installers
- Codex-specific approval adapters
- URL-mode elicitation
- provider OAuth/secrets flows
- remote approval service
- child mandate delegation

## Open Questions

- Does the current MCP SDK/runtime code path expose client capabilities to the
  daemon-backed `tools/call` handler cleanly enough, or does the stdio adapter
  need a small session state object?
- Should `approve for session` be represented as a longer-lived local approval,
  or should Switchboard keep approval decisions tied to the mandate lease and
  exact tool/gate pair for now?
- Should `cancel` mark the approval request stale, denied, or leave it pending?
  Conservative default: leave retryable pending only while the original call is
  alive, then stale on disconnect.
