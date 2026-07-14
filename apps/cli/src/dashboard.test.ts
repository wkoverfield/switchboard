import { mkdtemp, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createApprovalRequest,
  createJsonlAuditLogger,
  createMandate
} from "@switchboard-mcp/core";
import { collectDashboardState, startDashboard } from "./dashboard.js";

async function requestStatusWithHost(url: string, host: string): Promise<number> {
  const target = new URL(url);
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: { host }
      },
      (response) => {
        response.resume();
        response.once("end", () => resolveRequest(response.statusCode ?? 0));
      }
    );
    request.once("error", rejectRequest);
    request.end();
  });
}

async function makeStores() {
  const root = await mkdtemp(join(tmpdir(), "switchboard-dashboard-"));
  const auditLogPath = join(root, "switchboard.jsonl");
  const mandateStorePath = join(root, "mandates.json");
  const approvalStorePath = join(root, "approvals.json");

  const logger = createJsonlAuditLogger({ path: auditLogPath });
  await logger.log({
    action: "tool_call",
    status: "ok",
    profileName: "github_ci",
    toolName: "github_ci_get_job_logs",
    mandateId: "fix-ci"
  });
  await logger.log({
    action: "tool_call",
    status: "error",
    profileName: "github_ci",
    toolName: "github_ci_delete_file",
    mandateId: "fix-ci",
    error: "tool github_ci_delete_file is denied for mandate fix-ci"
  });

  await createMandate({
    path: mandateStorePath,
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "main",
    agentRole: "agent",
    profiles: ["github_ci"],
    lease: "4h",
    allowedTools: ["github_ci_*"],
    deniedTools: ["github_ci_delete_file"],
    approvalRequiredTools: [
      {
        id: "gate-7",
        toolPattern: "github_ci_rerun_workflow",
        reason: "Human review before rerunning CI"
      }
    ],
    createdBy: "test"
  });

  return { root, auditLogPath, mandateStorePath, approvalStorePath };
}

describe("dashboard", () => {
  it("collects passes, denials, and the audit stream from local state", async () => {
    const stores = await makeStores();
    const state = await collectDashboardState(stores);

    expect(state.ok).toBe(true);
    expect(state.schemaVersion).toBe("switchboard.dashboard-state.v2");
    expect(state.counts).toMatchObject({
      activePasses: 1,
      pendingApprovals: 0,
      allowedCalls: 1,
      gatedCalls: 0,
      deniedCalls: 1,
      errorCalls: 0
    });
    expect(state.mode).toBe("live");
    expect(state.sourceHealth).toEqual({
      mandates: "ok",
      approvals: "ok",
      audit: "ok"
    });
    expect(state.passes[0]).toMatchObject({
      branch: "main",
      profiles: ["github_ci"],
      deniedTools: ["github_ci_delete_file"],
      approvalGates: [
        expect.objectContaining({
          id: "gate-7",
          toolPattern: "github_ci_rerun_workflow"
        })
      ]
    });
    // Newest first for the stream.
    expect(state.audit[0]).toMatchObject({
      status: "error",
      toolName: "github_ci_delete_file"
    });
  });

  it("keeps approval gate context and does not count gated calls as denials", async () => {
    const stores = await makeStores();
    const mandateExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await createApprovalRequest({
      path: stores.approvalStorePath,
      mandateId: "fix-ci",
      repoPath: stores.root,
      branch: "main",
      toolName: "github_ci_rerun_workflow",
      approvalGateId: "gate-7",
      approvalGatePattern: "github_ci_rerun_workflow",
      expiresAt: mandateExpiresAt
    });
    const logger = createJsonlAuditLogger({ path: stores.auditLogPath });
    await logger.log({
      action: "tool_call",
      status: "error",
      profileName: "github_ci",
      toolName: "github_ci_rerun_workflow",
      mandateId: "fix-ci",
      approvalGateId: "gate-7",
      error: "requires approval by pass gate gate-7"
    });

    const state = await collectDashboardState(stores);

    expect(state.counts).toMatchObject({
      pendingApprovals: 1,
      allowedCalls: 1,
      gatedCalls: 1,
      deniedCalls: 1,
      errorCalls: 0
    });
    expect(state.pendingApprovals[0]).toMatchObject({
      approvalGateId: "gate-7",
      approvalGatePattern: "github_ci_rerun_workflow"
    });
  });

  it("separates policy denials, human denials, gates, and runtime errors", async () => {
    const stores = await makeStores();
    const logger = createJsonlAuditLogger({ path: stores.auditLogPath });
    await logger.log({
      action: "tool_call",
      status: "error",
      toolName: "github_ci_rerun_workflow",
      mandateId: "fix-ci",
      approvalGateId: "gate-7",
      error: "requires approval by pass gate gate-7"
    });
    await logger.log({
      action: "tool_call",
      status: "error",
      toolName: "github_ci_rerun_workflow",
      mandateId: "fix-ci",
      approvalGateId: "gate-7",
      error: "approval request approval-1 was denied"
    });
    await logger.log({
      action: "tool_call",
      status: "error",
      toolName: "github_ci_get_job_logs",
      mandateId: "fix-ci",
      error: "upstream timed out"
    });
    await logger.log({
      action: "tool_call",
      status: "error",
      toolName: "github_ci_create_issue",
      mandateId: "fix-ci",
      error: 'tool "github_ci_create_issue" is not allowed by mandate policy'
    });
    await logger.log({
      action: "approval_elicitation",
      status: "ok",
      toolName: "github_ci_rerun_workflow",
      mandateId: "fix-ci",
      approvalDecision: "denied"
    });
    await logger.log({
      action: "approval_elicitation",
      status: "error",
      toolName: "github_ci_rerun_workflow",
      mandateId: "fix-ci",
      approvalDecision: "cancelled",
      error: "approval elicitation was cancelled"
    });
    await logger.log({
      action: "approval_elicitation",
      status: "error",
      toolName: "github_ci_rerun_workflow",
      mandateId: "fix-ci",
      approvalDecision: "failed",
      error: "approval elicitation failed"
    });

    const state = await collectDashboardState(stores);

    expect(state.counts).toMatchObject({
      allowedCalls: 1,
      gatedCalls: 1,
      deniedCalls: 3,
      errorCalls: 1
    });
    expect(
      state.audit.map((entry) => [entry.toolName, entry.dashboardOutcome])
    ).toEqual(
      expect.arrayContaining([
        ["github_ci_rerun_workflow", "gated"],
        ["github_ci_rerun_workflow", "denied"],
        ["github_ci_get_job_logs", "error"],
        ["github_ci_create_issue", "denied"]
      ])
    );
    expect(
      state.audit.find((entry) => entry.approvalDecision === "denied")
    ).toMatchObject({ dashboardOutcome: "denied" });
    expect(
      state.audit.find((entry) => entry.approvalDecision === "cancelled")
    ).toMatchObject({ dashboardOutcome: "cancelled" });
    expect(
      state.audit.find((entry) => entry.approvalDecision === "failed")
    ).toMatchObject({ dashboardOutcome: "error" });
  });

  it("returns empty state when no local stores exist yet", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-dashboard-"));
    const state = await collectDashboardState({
      auditLogPath: join(root, "missing.jsonl"),
      mandateStorePath: join(root, "missing-mandates.json"),
      approvalStorePath: join(root, "missing-approvals.json")
    });

    expect(state.passes).toEqual([]);
    expect(state.pendingApprovals).toEqual([]);
    expect(state.audit).toEqual([]);
    expect(state.mode).toBe("idle");
  });

  it("projects strict mode without relying on audit prose", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-dashboard-"));
    const state = await collectDashboardState({
      enforcement: "strict",
      enforcementRepoPath: root,
      auditLogPath: join(root, "missing.jsonl"),
      mandateStorePath: join(root, "missing-mandates.json"),
      approvalStorePath: join(root, "missing-approvals.json")
    });

    expect(state.repoEnforcement).toBe("strict");
    expect(state.enforcementRepoPath).toBe(root);
    expect(state.mode).toBe("idle");
  });

  it("marks unreadable stores as degraded instead of safe empty state", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-dashboard-"));
    const mandateStorePath = join(root, "mandates.json");
    await writeFile(mandateStorePath, "{not-json", "utf8");

    const state = await collectDashboardState({
      mandateStorePath,
      auditLogPath: join(root, "missing.jsonl"),
      approvalStorePath: join(root, "missing-approvals.json")
    });

    expect(state.sourceHealth.mandates).toBe("error");
    expect(state.mode).toBe("degraded");
  });

  it("serves the page and the state API on localhost only", async () => {
    const stores = await makeStores();
    const dashboard = await startDashboard({ ...stores, port: 0 });

    try {
      expect(dashboard.url).toContain("127.0.0.1");

      const page = await fetch(`${dashboard.url}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("x-frame-options")).toBe("DENY");
      expect(page.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'"
      );
      const html = await page.text();
      expect(html).toContain("SWITCHBOARD");
      expect(html).toContain('<span class="wordmark">switchboard</span>');
      expect(html).toContain("Audit stream");
      expect(html).toContain("Hash-chained · local");
      expect(html).toContain('id="enforcement-label"');
      expect(html).toContain('id="filter-toggle"');
      expect(html).not.toContain("fonts.googleapis.com");

      const api = await fetch(`${dashboard.url}/api/state`);
      expect(api.status).toBe(200);
      const state = (await api.json()) as {
        counts: { deniedCalls: number; gatedCalls: number };
        passes: unknown[];
      };
      expect(state.counts.deniedCalls).toBe(1);
      expect(state.counts.gatedCalls).toBe(0);
      expect(state.passes).toHaveLength(1);

      expect(
        await requestStatusWithHost(
          `${dashboard.url}/api/state`,
          "attacker.example"
        )
      ).toBe(403);

      const missing = await fetch(`${dashboard.url}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await dashboard.close();
    }
  });

  it("rejects non-loopback dashboard hosts", async () => {
    await expect(startDashboard({ host: "0.0.0.0", port: 0 })).rejects.toThrow(
      "loopback-only"
    );
    await expect(startDashboard({ host: "127.999.0.1", port: 0 })).rejects.toThrow(
      "loopback-only"
    );
  });
});
