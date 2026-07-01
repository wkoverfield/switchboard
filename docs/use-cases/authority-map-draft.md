# Authority Map Draft

Authority Map Draft is the first agent-operable path for turning an arbitrary
MCP tool surface into a reviewable Switchboard authority plan.

Provider safety templates remain useful examples, but agents do not need
Switchboard to hand-code every provider before they can make progress. A lead
agent can discover the tools already configured for a repo, ask Switchboard for
a conservative draft, explain the plan to the human, and use the resulting JSON
as the basis for a reviewed mandate policy.

## Commands

```bash
switchboard authority draft --profile github_stockr --json
switchboard authority check authority-map.yaml --json
```

V0 is intentionally non-mutating:

- no `.switchboard.yaml` writes
- no durable authority-map storage
- no automatic mandate creation
- no LLM call inside Switchboard

## Draft Posture

The draft is deterministic and conservative:

- read/list/get/inspect/search/log/status-shaped tools are allowed
- create/update/write/execute/deploy/refund/migrate-shaped tools require
  approval
- prod/live/admin/root/service-role/secret/token/delete/drop/truncate-shaped
  tools are denied
- unknown tools go to review and are denied in the suggested mandate policy

The agent can improve the draft, but Switchboard validates the artifact and the
human approves before it becomes operational policy.

## Eval

The deterministic fresh-agent eval exercises this flow against an unknown
fixture provider:

```bash
pnpm build
pnpm eval:fresh-agent-authority-map
```

It checks that an agent can discover the tool surface, draft/check a
conservative map, keep review visible, avoid secret leakage, avoid config
mutation, and explain how the JSON becomes a safer mandate proposal.

## Next Phase

After V0 proves useful, add explicit apply/storage support and a
`mandate create --from-authority` path. Those should stay backup-protected and
human-approved; generated authority should not silently become runtime power.
