import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMandate,
  decideApprovalRequest,
  listApprovalRequests,
  readAuditLogEntries,
  resolveAuditLogPath
} from "@switchboard-mcp/core";
import { handleDaemonRequest } from "./daemon-runtime.js";

const fixtureServerPath = fileURLToPath(
  new URL("../../../packages/mcp-runtime/fixtures/echo-server.mjs", import.meta.url)
);

describe("daemon runtime mandate context", () => {
  const previousStateHome = process.env.XDG_STATE_HOME;

  afterEach(() => {
    if (previousStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousStateHome;
    }
  });

  it("rejects mandate-scoped list_tools when the daemon cwd is on another branch", async () => {
    const root = await makeMandateRepoOnWrongBranch();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "list",
          type: "list_tools",
          mandateId: "fix-ci"
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: false,
      error: expect.stringContaining(
        'mandate "fix-ci" is scoped to branch "fix/ci", but current git branch is "main"'
      )
    });
  });

  it("rejects mandate-scoped call_tool when the daemon cwd is on another branch", async () => {
    const root = await makeMandateRepoOnWrongBranch();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_checks_list",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: expect.stringContaining(
        'mandate "fix-ci" is scoped to branch "fix/ci", but current git branch is "main"'
      )
    });
  });

  it("rejects daemon-routed tool calls denied by mandate policy", async () => {
    const root = await makePolicyRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_whoami",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: 'tool "github_findu_whoami" is not allowed by mandate policy'
    });
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toMatchObject([
      {
        action: "tool_call",
        status: "error",
        mandateId: "fix-ci",
        toolName: "github_findu_whoami",
        error: 'tool "github_findu_whoami" is not allowed by mandate policy'
      }
    ]);
  });

  it("filters daemon list_tools results through mandate policy", async () => {
    const root = await makePolicyRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "list",
          type: "list_tools",
          mandateId: "fix-ci"
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: true,
      tools: [expect.objectContaining({ name: "github_findu_echo" })]
    });
  });

  it("rejects denied daemon calls before opening upstream sessions", async () => {
    const root = await makeBrokenPolicyRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_whoami",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error: 'tool "github_findu_whoami" is not allowed by mandate policy'
    });
  });

  it("rejects approval-gated daemon calls with audit metadata", async () => {
    const root = await makeApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by mandate gate "gate-1"; approval request approval-1'
    });
    await expect(
      listApprovalRequests({ repoPath: root, mandateId: "fix-ci" })
    ).resolves.toMatchObject([
      {
        id: "approval-1",
        runtimeStatus: "pending",
        toolName: "github_findu_echo",
        approvalGateId: "gate-1"
      }
    ]);
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toMatchObject([
      {
        action: "tool_call",
        status: "error",
        mandateId: "fix-ci",
        toolName: "github_findu_echo",
        approvalRequestId: "approval-1",
        approvalGateId: "gate-1",
        approvalGatePattern: "github_findu_echo",
        error:
          'tool "github_findu_echo" requires approval by mandate gate "gate-1"'
      }
    ]);
  });

  it("routes approval-gated daemon calls after a request is approved", async () => {
    const root = await makeApprovalRepo();

    await handleDaemonRequest(
      JSON.stringify({
        id: "call",
        type: "call_tool",
        name: "github_findu_echo",
        mandateId: "fix-ci",
        arguments: { message: "hello" }
      }),
      { cwd: root }
    );
    await decideApprovalRequest({
      id: "approval-1",
      status: "approved"
    });

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          arguments: { message: "hello" }
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: true,
      type: "tool_result"
    });
    await expect(
      readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tool_call",
          status: "ok",
          mandateId: "fix-ci",
          toolName: "github_findu_echo",
          approvalRequestId: "approval-1"
        })
      ])
    );
  });

  it("filters approval-gated tools from daemon list_tools results", async () => {
    const root = await makeApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "list",
          type: "list_tools",
          mandateId: "fix-ci"
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "list",
      ok: true,
      tools: [expect.objectContaining({ name: "github_findu_whoami" })]
    });
  });

  it("rejects approval-gated daemon calls before opening upstream sessions", async () => {
    const root = await makeBrokenApprovalRepo();

    await expect(
      handleDaemonRequest(
        JSON.stringify({
          id: "call",
          type: "call_tool",
          name: "github_findu_echo",
          mandateId: "fix-ci",
          arguments: {}
        }),
        { cwd: root }
      )
    ).resolves.toMatchObject({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by mandate gate "gate-1"; approval request approval-1'
    });
  });
});

async function makeMandateRepoOnWrongBranch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  execFileSync("git", ["init", "-b", "main"], {
    cwd: root,
    stdio: "ignore"
  });
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    lease: "2h"
  });

  return root;
}

async function makeBrokenPolicyRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      "      command: definitely-not-a-real-switchboard-command"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_echo"],
    lease: "2h"
  });

  return root;
}

async function makeBrokenApprovalRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      "      command: definitely-not-a-real-switchboard-command"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_*"],
    approvalRequiredTools: ["github_findu_echo"],
    lease: "2h"
  });

  return root;
}

async function makeApprovalRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-findu"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_*"],
    approvalRequiredTools: ["github_findu_echo"],
    lease: "2h"
  });

  return root;
}

async function makePolicyRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-runtime-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-findu"
    ].join("\n")
  );
  await createMandate({
    task: "fix-ci",
    repoPath: root,
    worktreePath: root,
    branch: "fix/ci",
    agentRole: "implementer",
    profiles: ["github_findu"],
    allowedTools: ["github_findu_echo"],
    lease: "2h"
  });

  return root;
}
