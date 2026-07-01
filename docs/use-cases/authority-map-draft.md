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
switchboard mandate create inspect-provider \
  --from-authority authority-map.yaml \
  --accept-review \
  --agent reviewer \
  --lease 1h
```

Draft and check are intentionally non-mutating:

- no `.switchboard.yaml` writes
- no durable authority-map storage
- no LLM call inside Switchboard

Mandate creation is explicit. `--from-authority` validates the map, uses its
single profile, applies `suggestedMandatePolicy`, and refuses maps with warnings
or review tools unless the user passes `--accept-review`. Review tools remain
denied by the suggested policy; acknowledging review does not allow them.

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
conservative map, keep review visible, create a mandate from the reviewed map,
avoid secret leakage, avoid config mutation, and explain how the JSON becomes
a safer mandate policy.

## Next Phase

After the reviewed mandate path proves useful, add explicit apply/storage
support for reusable authority maps. That should stay backup-protected and
human-approved; generated authority should not silently become runtime power.
