import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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

  it("keeps a full tool-call timeout budget after approval waits", () => {
    expect(daemonToolCallTimeoutMs()).toBe(60_000);
    expect(daemonToolCallTimeoutMs({ approvalWaitMs: 30_000 })).toBe(90_000);
    expect(daemonToolCallTimeoutMs({ approvalWaitMs: 600_000 })).toBe(660_000);
  });
});

async function startCaptureDaemon(): Promise<{
  socketPath: string;
  server: Server;
  requests: unknown[];
}> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-daemon-client-"));
  const socketPath = join(root, "daemon.sock");
  const requests: unknown[] = [];
  const server = createServer((socket) => {
    handleCaptureSocket(socket, requests);
  });
  await listen(server, socketPath);
  server.on("close", () => {
    void rm(root, { force: true, recursive: true });
  });

  return { socketPath, server, requests };
}

function handleCaptureSocket(socket: Socket, requests: unknown[]): void {
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
