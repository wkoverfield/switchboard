import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DaemonRequestError,
  callDaemonTool,
  daemonToolCallTimeoutMs,
  listDaemonTools,
  parseDaemonResponse
} from "./daemon-client.js";

describe("daemon client response validation", () => {
  it("accepts valid pong responses", () => {
    expect(
      parseDaemonResponse(
        JSON.stringify({
          id: "one",
          ok: true,
          type: "pong",
          version: "0.1.0"
        })
      )
    ).toEqual({
      id: "one",
      ok: true,
      type: "pong",
      version: "0.1.0"
    });
  });

  it("accepts valid tool list responses", () => {
    expect(
      parseDaemonResponse(
        JSON.stringify({
          id: "tools",
          ok: true,
          type: "tools",
          version: "0.1.0",
          tools: [
            {
              name: "fixture_echo",
              profileName: "fixture",
              namespace: "fixture",
              upstreamName: "echo",
              description: "Echo input.",
              inputSchema: { type: "object" }
            }
          ]
        })
      )
    ).toEqual({
      id: "tools",
      ok: true,
      type: "tools",
      version: "0.1.0",
      tools: [
        {
          name: "fixture_echo",
          profileName: "fixture",
          namespace: "fixture",
          upstreamName: "echo",
          description: "Echo input.",
          inputSchema: { type: "object" }
        }
      ]
    });
  });

  it("accepts valid tool call responses", () => {
    expect(
      parseDaemonResponse(
        JSON.stringify({
          id: "call",
          ok: true,
          type: "tool_result",
          version: "0.1.0",
          result: {
            content: [
              {
                type: "text",
                text: "ok"
              }
            ]
          }
        })
      )
    ).toEqual({
      id: "call",
      ok: true,
      type: "tool_result",
      version: "0.1.0",
      result: {
        content: [
          {
            type: "text",
            text: "ok"
          }
        ]
      }
    });
  });

  it("preserves structured approval-required error metadata", () => {
    expect(
      parseDaemonResponse(
        JSON.stringify({
          id: "call",
          ok: false,
          error: "approval required",
          approvalRequired: {
            approvalRequestId: "approval-1",
            mandateId: "fix-ci",
            mandateUid: "fix-ci:2026-06-20T20:00:00.000Z",
            repoPath: "/repo",
            branch: "fix/ci",
            task: "fix-ci",
            agentRole: "implementer",
            toolName: "github_findu_echo",
            approvalGateId: "gate-1",
            approvalGatePattern: "github_findu_echo",
            approvalGateReason: "remote state",
            approvalGateRisk: "high",
            approvalGateLabels: ["remote-state", "ci"],
            expiresAt: "2026-06-20T22:00:00.000Z"
          }
        })
      )
    ).toEqual({
      id: "call",
      ok: false,
      error: "approval required",
      approvalRequired: {
        approvalRequestId: "approval-1",
        mandateId: "fix-ci",
        mandateUid: "fix-ci:2026-06-20T20:00:00.000Z",
        repoPath: "/repo",
        branch: "fix/ci",
        task: "fix-ci",
        agentRole: "implementer",
        toolName: "github_findu_echo",
        approvalGateId: "gate-1",
        approvalGatePattern: "github_findu_echo",
        approvalGateReason: "remote state",
        approvalGateRisk: "high",
        approvalGateLabels: ["remote-state", "ci"],
        expiresAt: "2026-06-20T22:00:00.000Z"
      }
    });
  });

  it("rejects malformed success responses", () => {
    expect(() =>
      parseDaemonResponse(JSON.stringify({ id: "one", ok: true, type: "pong" }))
    ).toThrow("Daemon success response version is missing or invalid.");
  });

  it("rejects malformed error responses", () => {
    expect(() =>
      parseDaemonResponse(JSON.stringify({ id: "one", ok: false }))
    ).toThrow("Daemon error response message is missing or invalid.");
  });

  it("rejects responses without a string id", () => {
    expect(() =>
      parseDaemonResponse(
        JSON.stringify({ ok: true, type: "pong", version: "0.1.0" })
      )
    ).toThrow("Daemon response id is missing or invalid.");
  });

  it("rejects malformed tool list responses", () => {
    expect(() =>
      parseDaemonResponse(
        JSON.stringify({
          id: "tools",
          ok: true,
          type: "tools",
          version: "0.1.0",
          tools: [
            {
              name: "fixture_echo",
              profileName: "fixture",
              namespace: "fixture",
              upstreamName: "echo"
            }
          ]
        })
      )
    ).toThrow("Daemon tools response contains an invalid tool schema.");
  });

  it("rejects malformed tool call responses", () => {
    expect(() =>
      parseDaemonResponse(
        JSON.stringify({
          id: "call",
          ok: true,
          type: "tool_result",
          version: "0.1.0",
          result: {
            content: [
              {
                type: "unknown",
                text: "nope"
              }
            ]
          }
        })
      )
    ).toThrow("Daemon tool result response result is invalid.");
  });

  it("sends mandate context on list_tools requests", async () => {
    const { socketPath, server, requests } = await startCaptureDaemon();
    try {
      await listDaemonTools(socketPath, { mandateId: "fix-ci" });
      expect(requests[0]).toMatchObject({
        type: "list_tools",
        mandateId: "fix-ci"
      });
    } finally {
      await closeServer(server);
    }
  });

  it("sends mandate context on call_tool requests", async () => {
    const { socketPath, server, requests } = await startCaptureDaemon();
    try {
      await callDaemonTool(
        socketPath,
        "github_checks_list",
        { owner: "findu" },
        { mandateId: "fix-ci" }
      );
      expect(requests[0]).toMatchObject({
        type: "call_tool",
        name: "github_checks_list",
        arguments: { owner: "findu" },
        mandateId: "fix-ci"
      });
    } finally {
      await closeServer(server);
    }
  });

  it("sends approval wait duration on call_tool requests", async () => {
    const { socketPath, server, requests } = await startCaptureDaemon();
    try {
      await callDaemonTool(
        socketPath,
        "github_checks_rerun",
        { owner: "findu" },
        { mandateId: "fix-ci", approvalWaitMs: 30_000 }
      );
      expect(requests[0]).toMatchObject({
        type: "call_tool",
        name: "github_checks_rerun",
        arguments: { owner: "findu" },
        mandateId: "fix-ci",
        approvalWaitMs: 30_000
      });
    } finally {
      await closeServer(server);
    }
  });

  it("throws daemon request errors with approval metadata", async () => {
    const { socketPath, server } = await startCaptureDaemon({
      response: {
        ok: false,
        error: "approval required",
        approvalRequired: {
          approvalRequestId: "approval-1",
          mandateId: "fix-ci",
          repoPath: "/repo",
          branch: "fix/ci",
          task: "fix-ci",
          agentRole: "implementer",
          toolName: "github_findu_echo",
          approvalGateId: "gate-1",
          approvalGatePattern: "github_findu_echo",
          expiresAt: "2026-06-20T22:00:00.000Z"
        }
      }
    });
    try {
      await expect(
        callDaemonTool(socketPath, "github_findu_echo")
      ).rejects.toMatchObject({
        name: "DaemonRequestError",
        response: {
          approvalRequired: {
            approvalRequestId: "approval-1",
            mandateId: "fix-ci"
          }
        }
      });
      await expect(callDaemonTool(socketPath, "github_findu_echo")).rejects.toBeInstanceOf(
        DaemonRequestError
      );
    } finally {
      await closeServer(server);
    }
  });

  it("keeps a full tool-call timeout budget after approval waits", () => {
    expect(daemonToolCallTimeoutMs()).toBe(60_000);
    expect(daemonToolCallTimeoutMs({ approvalWaitMs: 30_000 })).toBe(90_000);
    expect(daemonToolCallTimeoutMs({ approvalWaitMs: 600_000 })).toBe(660_000);
  });
});

async function startCaptureDaemon(options: {
  response?: Record<string, unknown>;
} = {}): Promise<{
  socketPath: string;
  server: Server;
  requests: unknown[];
}> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-client-"));
  const socketPath = join(root, "daemon.sock");
  const requests: unknown[] = [];
  const server = createServer((socket) => {
    handleCaptureSocket(socket, requests, options.response);
  });
  await listen(server, socketPath);
  server.on("close", () => {
    void rm(root, { force: true, recursive: true });
  });

  return { socketPath, server, requests };
}

function handleCaptureSocket(
  socket: Socket,
  requests: unknown[],
  response: Record<string, unknown> | undefined
): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    if (!buffer.includes("\n")) {
      return;
    }

    const request = JSON.parse(buffer.trim()) as { id?: string; type?: string };
    requests.push(request);
    const base = {
      id: typeof request.id === "string" ? request.id : "unknown",
      ok: true,
      version: "0.1.0"
    };
    if (response) {
      socket.end(
        `${JSON.stringify({
          id: base.id,
          ...response
        })}\n`
      );
      return;
    }
    if (request.type === "list_tools") {
      socket.end(
        `${JSON.stringify({
          ...base,
          type: "tools",
          tools: []
        })}\n`
      );
      return;
    }

    socket.end(
      `${JSON.stringify({
        ...base,
        type: "tool_result",
        result: {
          content: [{ type: "text", text: "ok" }]
        }
      })}\n`
    );
  });
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
