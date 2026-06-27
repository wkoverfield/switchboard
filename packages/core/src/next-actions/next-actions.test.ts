import { describe, expect, it } from "vitest";
import { planRecommendedNextAction } from "./next-actions.js";

describe("recommended next action planner", () => {
  it("ranks recovery and launch actions in product order", () => {
    const result = planRecommendedNextAction([
      {
        kind: "client-install",
        command: "switchboard install codex --write",
        reason: "client missing"
      },
      {
        kind: "mandate-create",
        command: "switchboard mandate create --from github-ci",
        reason: "create authority"
      },
      {
        kind: "bypass-cleanup",
        command: "switchboard import --write --cleanup-client",
        reason: "cleanup direct MCP"
      },
      {
        kind: "missing-secret",
        command: "switchboard secrets set github/demo/dev/token --value-stdin",
        reason: "missing token"
      }
    ]);

    expect(result.primary).toMatchObject({
      kind: "missing-secret",
      command: "switchboard secrets set github/demo/dev/token --value-stdin"
    });
    expect(result.alternatives.map((item) => item.kind)).toEqual([
      "bypass-cleanup",
      "client-install",
      "mandate-create"
    ]);
  });

  it("deduplicates repeated commands within the same kind", () => {
    const result = planRecommendedNextAction([
      {
        kind: "client-install",
        command: "switchboard install codex --write",
        reason: "first"
      },
      {
        kind: "client-install",
        command: "switchboard install codex --write",
        reason: "second"
      }
    ]);

    expect(result.primary?.reason).toBe("first");
    expect(result.alternatives).toEqual([]);
  });
});
