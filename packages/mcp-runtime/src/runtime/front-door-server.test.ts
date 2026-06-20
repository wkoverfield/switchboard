import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApprovalRequest,
  listApprovalRequests,
  markApprovalRequestStale,
  readAuditLogEntries,
  resolveAuditLogPath
} from "@switchboard-mcp/core";
import { DaemonRequestError } from "../daemon/daemon-client.js";
import {
  connectDaemonBackedSwitchboardMcpServer,
  connectSwitchboardMcpServer
} from "./front-door-server.js";
import { GenericMcpRouter } from "./generic-router.js";
import type { StdioUpstreamProfile } from "./stdio-upstream.js";

const fixtureServerPath = fileURLToPath(
  new URL("../../fixtures/echo-server.mjs", import.meta.url)
);

describe("Switchboard MCP front door", () => {
  const previousStateHome = process.env.XDG_STATE_HOME;

  afterEach(() => {
    if (previousStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousStateHome;
    }
  });

  it("exposes discovered upstream tools with Switchboard namespaces", async () => {
    const router = new GenericMcpRouter([
      fixtureProfile("alpha", "alpha_tools"),
      fixtureProfile("beta", "beta_tools")
    ]);
    const client = new Client({ name: "front-door-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectSwitchboardMcpServer(router, serverTransport)
      ]);

      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name).sort();

      expect(toolNames).toEqual([
        "alpha_tools_echo",
        "alpha_tools_whoami",
        "beta_tools_echo",
        "beta_tools_whoami"
      ]);
      expect(result.tools[0]?._meta?.switchboard).toMatchObject({
        profileName: "alpha",
        namespace: "alpha_tools"
      });
    } finally {
      await client.close();
      await router.close();
    }
  });

  it("routes MCP tool calls through the namespaced front door", async () => {
    const router = new GenericMcpRouter([
      fixtureProfile("alpha", "alpha_tools"),
      fixtureProfile("beta", "beta_tools")
    ]);
    const client = new Client({ name: "front-door-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectSwitchboardMcpServer(router, serverTransport)
      ]);

      await client.listTools();
      const result = await client.callTool({
        name: "beta_tools_echo",
        arguments: { message: "front-door" }
      });

      expect(textContent(result)).toBe("beta:front-door");
    } finally {
      await client.close();
      await router.close();
    }
  });

  it("closes upstream router connections when the front-door connection closes", async () => {
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")]);
    const closeSpy = vi.spyOn(router, "close");
    const client = new Client({ name: "front-door-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectSwitchboardMcpServer(router, serverTransport)
      ]);

      await client.listTools();
      await client.close();

      expect(closeSpy).toHaveBeenCalled();
    } finally {
      await router.close();
    }
  });

  it("exposes daemon-discovered tools through the daemon-backed front door", async () => {
    const client = new Client({ name: "front-door-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectDaemonBackedSwitchboardMcpServer("/tmp/switchboard-test.sock", serverTransport, {
          listTools: async () => [
            {
              name: "daemon_echo",
              profileName: "daemon",
              namespace: "daemon",
              upstreamName: "echo",
              description: "Echo from daemon.",
              inputSchema: { type: "object" }
            }
          ]
        })
      ]);

      const result = await client.listTools();
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toMatchObject({
        name: "daemon_echo",
        description: "Echo from daemon.",
        _meta: {
          switchboard: {
            profileName: "daemon",
            namespace: "daemon",
            upstreamName: "echo"
          }
        }
      });
    } finally {
      await client.close();
    }
  });

  it("routes daemon-backed tool calls through the daemon client", async () => {
    const client = new Client({ name: "front-door-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const callTool = vi.fn(async () => ({
      content: [
        {
          type: "text" as const,
          text: "daemon:later"
        }
      ]
    }));

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectDaemonBackedSwitchboardMcpServer("/tmp/switchboard-test.sock", serverTransport, {
          listTools: async () => [
            {
              name: "daemon_echo",
              profileName: "daemon",
              namespace: "daemon",
              upstreamName: "echo",
              inputSchema: { type: "object" }
            }
          ],
          callTool
        })
      ]);

      const result = await client.callTool({
        name: "daemon_echo",
        arguments: { message: "later" }
      });
      expect(textContent(result)).toBe("daemon:later");
      expect(callTool).toHaveBeenCalledWith("daemon_echo", { message: "later" });
    } finally {
      await client.close();
    }
  });

  it("elicits approval in clients that support form elicitation", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-front-door-"));
    process.env.XDG_STATE_HOME = join(root, "state");
    await createApprovalRequest({
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_echo",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_echo",
      approvalGateReason: "rerunning CI changes remote state",
      approvalGateRisk: "high",
      approvalGateLabels: ["remote-state", "ci"],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    const approvalError = new DaemonRequestError({
      id: "call",
      ok: false,
      error:
        'tool "github_findu_echo" requires approval by mandate gate "gate-1"; approval request approval-1 is pending.',
      approvalRequired: {
        approvalRequestId: "approval-1",
        mandateId: "fix-ci",
        repoPath: root,
        branch: "fix/ci",
        task: "fix-ci",
        agentRole: "implementer",
        toolName: "github_findu_echo",
        approvalGateId: "gate-1",
        approvalGatePattern: "github_findu_echo",
        approvalGateReason: "rerunning CI changes remote state",
        approvalGateRisk: "high",
        approvalGateLabels: ["remote-state", "ci"],
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      }
    });
    const callTool = vi
      .fn<() => Promise<{ content: Array<{ type: "text"; text: string }> }>>()
      .mockRejectedValueOnce(approvalError)
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "daemon:approved" }]
      });
    const client = new Client(
      { name: "front-door-test", version: "0.1.0" },
      { capabilities: { elicitation: { form: {} } } }
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const elicitationRequests: unknown[] = [];
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      elicitationRequests.push(request.params);
      return {
        action: "accept",
        content: {
          decision: "approve",
          reason: "CI rerun is expected"
        }
      };
    });

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectDaemonBackedSwitchboardMcpServer(
          "/tmp/switchboard-test.sock",
          serverTransport,
          {
            listTools: async () => [
              {
                name: "github_findu_echo",
                profileName: "github_findu",
                namespace: "github_findu",
                upstreamName: "echo",
                inputSchema: { type: "object" }
              }
            ],
            callTool
          }
        )
      ]);

      const result = await client.callTool({
        name: "github_findu_echo",
        arguments: { message: "later" }
      });

      expect(textContent(result)).toBe("daemon:approved");
      expect(callTool).toHaveBeenCalledTimes(2);
      expect(elicitationRequests).toEqual([
        expect.objectContaining({
          mode: "form",
          message: expect.stringContaining("Switchboard mandate approval required."),
          requestedSchema: expect.objectContaining({
            required: ["decision"]
          })
        })
      ]);
      await expect(
        listApprovalRequests({ repoPath: root, mandateId: "fix-ci" })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "approval-1",
          runtimeStatus: "approved",
          decisionReason: "CI rerun is expected"
        })
      ]);
      await expect(
        readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "approval_elicitation",
            status: "ok",
            approvalDecision: "approved",
            approvalRequestId: "approval-1"
          })
        ])
      );
    } finally {
      await client.close();
    }
  });

  it("keeps approval fallback behavior when clients lack form elicitation", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-front-door-"));
    process.env.XDG_STATE_HOME = join(root, "state");
    await createApprovalRequest({
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_echo",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_echo",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    const callTool = vi.fn(async () => {
      throw new DaemonRequestError({
        id: "call",
        ok: false,
        error: "approval required",
        approvalRequired: {
          approvalRequestId: "approval-1",
          mandateId: "fix-ci",
          repoPath: root,
          branch: "fix/ci",
          task: "fix-ci",
          agentRole: "implementer",
          toolName: "github_findu_echo",
          approvalGateId: "gate-1",
          approvalGatePattern: "github_findu_echo",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString()
        }
      });
    });
    const client = new Client({ name: "front-door-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectDaemonBackedSwitchboardMcpServer(
          "/tmp/switchboard-test.sock",
          serverTransport,
          {
            listTools: async () => [],
            callTool
          }
        )
      ]);

      await expect(
        client.callTool({ name: "github_findu_echo" })
      ).rejects.toThrow(/approval required/);
      expect(callTool).toHaveBeenCalledTimes(1);
      await expect(
        listApprovalRequests({ repoPath: root, mandateId: "fix-ci" })
      ).resolves.toEqual([
        expect.objectContaining({
          id: "approval-1",
          runtimeStatus: "pending"
        })
      ]);
    } finally {
      await client.close();
    }
  });

  it("audits and falls back when accepted elicitation decisions cannot be persisted", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-front-door-"));
    process.env.XDG_STATE_HOME = join(root, "state");
    await createApprovalRequest({
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_echo",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_echo",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    const callTool = vi.fn(async () => {
      throw new DaemonRequestError({
        id: "call",
        ok: false,
        error: "approval required",
        approvalRequired: {
          approvalRequestId: "approval-1",
          mandateId: "fix-ci",
          repoPath: root,
          branch: "fix/ci",
          task: "fix-ci",
          agentRole: "implementer",
          toolName: "github_findu_echo",
          approvalGateId: "gate-1",
          approvalGatePattern: "github_findu_echo",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString()
        }
      });
    });
    const client = new Client(
      { name: "front-door-test", version: "0.1.0" },
      { capabilities: { elicitation: { form: {} } } }
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client.setRequestHandler(ElicitRequestSchema, async () => {
      await markApprovalRequestStale({
        id: "approval-1",
        reason: "another client disconnected"
      });
      return {
        action: "accept",
        content: {
          decision: "approve"
        }
      };
    });

    try {
      await Promise.all([
        client.connect(clientTransport),
        connectDaemonBackedSwitchboardMcpServer(
          "/tmp/switchboard-test.sock",
          serverTransport,
          {
            listTools: async () => [],
            callTool
          }
        )
      ]);

      await expect(
        client.callTool({ name: "github_findu_echo" })
      ).rejects.toThrow(/approval required/);
      expect(callTool).toHaveBeenCalledTimes(1);
      await expect(
        readAuditLogEntries({ path: resolveAuditLogPath(), mandateId: "fix-ci" })
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "approval_elicitation",
            status: "error",
            approvalDecision: "failed",
            approvalRequestId: "approval-1",
            error: 'approval request "approval-1" is stale'
          })
        ])
      );
    } finally {
      await client.close();
    }
  });
});

function fixtureProfile(label: string, namespace: string): StdioUpstreamProfile {
  return {
    profileName: label,
    namespace,
    command: process.execPath,
    args: [fixtureServerPath, label]
  };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return "";
  }

  const first = result.content[0] as unknown;
  if (!isTextContent(first)) {
    return "";
  }

  return first.text;
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
}
