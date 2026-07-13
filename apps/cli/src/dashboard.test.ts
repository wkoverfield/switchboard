import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createJsonlAuditLogger,
  createMandate
} from "@switchboard-mcp/core";
import { collectDashboardState, startDashboard } from "./dashboard.js";

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
    allowedTools: ["github_ci_get_*"],
    deniedTools: ["github_ci_delete_file"],
    createdBy: "test"
  });

  return { auditLogPath, mandateStorePath, approvalStorePath };
}

describe("dashboard", () => {
  it("collects passes, denials, and the audit stream from local state", async () => {
    const stores = await makeStores();
    const state = await collectDashboardState(stores);

    expect(state.ok).toBe(true);
    expect(state.schemaVersion).toBe("switchboard.dashboard-state.v1");
    expect(state.counts).toMatchObject({
      activePasses: 1,
      pendingApprovals: 0,
      allowedCalls: 1,
      deniedCalls: 1
    });
    expect(state.passes[0]).toMatchObject({
      branch: "main",
      profiles: ["github_ci"],
      deniedTools: ["github_ci_delete_file"]
    });
    // Newest first for the stream.
    expect(state.audit[0]).toMatchObject({
      status: "error",
      toolName: "github_ci_delete_file"
    });
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
  });

  it("serves the page and the state API on localhost only", async () => {
    const stores = await makeStores();
    const dashboard = await startDashboard({ ...stores, port: 0 });

    try {
      expect(dashboard.url).toContain("127.0.0.1");

      const page = await fetch(`${dashboard.url}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      const html = await page.text();
      expect(html).toContain("SWITCHBOARD");
      expect(html).toContain("Audit stream");

      const api = await fetch(`${dashboard.url}/api/state`);
      expect(api.status).toBe(200);
      const state = (await api.json()) as {
        counts: { deniedCalls: number };
        passes: unknown[];
      };
      expect(state.counts.deniedCalls).toBe(1);
      expect(state.passes).toHaveLength(1);

      const missing = await fetch(`${dashboard.url}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await dashboard.close();
    }
  });
});
