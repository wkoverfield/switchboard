import { describe, expect, it } from "vitest";
import type { AuditLogEntry } from "../audit/audit-log.js";
import type { MandateWithStatus } from "../mandates/mandates.js";
import { buildFleetReport, renderFleetReport } from "./fleet-report.js";

function mandate(
  partial: Partial<MandateWithStatus> & {
    id: string;
    mandateUid: string;
  }
): MandateWithStatus {
  return {
    version: 1,
    task: partial.id,
    repoPath: "/repo",
    worktreePath: "/repo",
    branch: "main",
    agentRole: "implementer",
    profiles: ["p"],
    lease: "1h",
    createdAt: "2026-07-18T00:00:00.000Z",
    expiresAt: "2026-07-18T01:00:00.000Z",
    allowedTools: [],
    deniedTools: [],
    approvalGates: [],
    handoffState: "open",
    runtimeStatus: "active",
    ...partial
  } as MandateWithStatus;
}

function toolCall(
  mandateUid: string,
  toolName: string,
  status: "ok" | "error",
  error?: string
): AuditLogEntry {
  return {
    version: 1,
    timestamp: "2026-07-18T00:30:00.000Z",
    action: "tool_call",
    status,
    toolName,
    mandateUid,
    mandateId: mandateUid.split(":")[0] ?? mandateUid,
    ...(error ? { error } : {})
  };
}

describe("fleet delegation report", () => {
  it("builds a parent/child/grandchild tree with per-actor calls and denials", () => {
    const mandates = [
      mandate({ id: "root", mandateUid: "root:t0", agentRole: "orchestrator" }),
      mandate({
        id: "child",
        mandateUid: "child:t1",
        agentRole: "worker",
        parentMandateId: "root",
        parentMandateUid: "root:t0"
      }),
      mandate({
        id: "grandchild",
        mandateUid: "grandchild:t2",
        agentRole: "worker",
        parentMandateId: "child",
        parentMandateUid: "child:t1"
      })
    ];
    const auditEntries: AuditLogEntry[] = [
      toolCall("root:t0", "echo", "ok"),
      toolCall("child:t1", "echo", "ok"),
      toolCall("child:t1", "echo", "ok"),
      toolCall(
        "child:t1",
        "deploy_prod",
        "error",
        'tool "deploy_prod" is denied by mandate policy'
      ),
      toolCall("grandchild:t2", "read_data", "ok")
    ];

    const report = buildFleetReport({
      mandates,
      auditEntries,
      repoPath: "/repo"
    });

    expect(report.totals.mandates).toBe(3);
    expect(report.totals.ok).toBe(4);
    expect(report.totals.denied).toBe(1);

    expect(report.roots).toHaveLength(1);
    const root = report.roots[0];
    expect(root?.mandateId).toBe("root");
    expect(root?.depth).toBe(0);
    expect(root?.children).toHaveLength(1);

    const child = root?.children[0];
    expect(child?.mandateId).toBe("child");
    expect(child?.depth).toBe(1);
    const deployCall = child?.calls.find((c) => c.toolName === "deploy_prod");
    expect(deployCall?.denied).toBe(1);
    expect(deployCall?.reasons[0]).toContain("denied by mandate policy");

    const grandchild = child?.children[0];
    expect(grandchild?.mandateId).toBe("grandchild");
    expect(grandchild?.depth).toBe(2);
    expect(grandchild?.calls[0]?.toolName).toBe("read_data");

    const rendered = renderFleetReport(report);
    expect(rendered).toContain("root");
    expect(rendered).toContain("child");
    expect(rendered).toContain("grandchild");
    expect(rendered).toContain("DENIED");
  });

  it("correlates calls by mandateUid so same-id mandates never collide", () => {
    const mandates = [
      mandate({ id: "reused", mandateUid: "reused:early" }),
      mandate({ id: "reused", mandateUid: "reused:late" })
    ];
    const report = buildFleetReport({
      mandates,
      auditEntries: [toolCall("reused:late", "echo", "ok")]
    });
    // Both share id "reused"; the call must land only on the uid that made it.
    expect(report.totals.calls).toBe(1);
  });

  it("renders an empty tree cleanly", () => {
    const report = buildFleetReport({ mandates: [], auditEntries: [] });
    expect(renderFleetReport(report)).toContain("No mandates found");
  });
});
