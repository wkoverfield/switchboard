import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
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

  it("returns a tool error for daemon-backed tool calls until call forwarding lands", async () => {
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
              inputSchema: { type: "object" }
            }
          ]
        })
      ]);

      const result = await client.callTool({
        name: "daemon_echo",
        arguments: { message: "later" }
      });
      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain(
        "Daemon-backed MCP tool calls are not implemented yet"
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
