import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GenericMcpRouter } from "./generic-router.js";
import type { StdioUpstreamProfile } from "./stdio-upstream.js";

const fixtureServerPath = fileURLToPath(
  new URL("../../fixtures/echo-server.mjs", import.meta.url)
);

describe("GenericMcpRouter", () => {
  it("discovers namespaced tools from duplicate upstream tool names", async () => {
    const router = new GenericMcpRouter([
      fixtureProfile("alpha", "alpha_tools"),
      fixtureProfile("beta", "beta_tools")
    ]);

    try {
      const tools = await router.discoverTools();
      const toolNames = tools.map((tool) => tool.name).sort();

      expect(toolNames).toContain("alpha_tools_echo");
      expect(toolNames).toContain("beta_tools_echo");
      expect(toolNames).toContain("alpha_tools_whoami");
      expect(toolNames).toContain("beta_tools_whoami");
    } finally {
      await router.close();
    }
  });

  it("routes namespaced tool calls to the correct upstream profile", async () => {
    const router = new GenericMcpRouter([
      fixtureProfile("alpha", "alpha_tools"),
      fixtureProfile("beta", "beta_tools")
    ]);

    try {
      await router.discoverTools();
      const alphaResult = await router.callTool("alpha_tools_echo", {
        message: "hello"
      });
      const betaResult = await router.callTool("beta_tools_echo", {
        message: "hello"
      });

      expect(textContent(alphaResult)).toBe("alpha:hello");
      expect(textContent(betaResult)).toBe("beta:hello");
    } finally {
      await router.close();
    }
  });

  it("rejects namespaced collisions within the same namespace", async () => {
    const router = new GenericMcpRouter([
      fixtureProfile("alpha", "shared"),
      fixtureProfile("beta", "shared")
    ]);

    try {
      await expect(router.discoverTools()).rejects.toThrow(
        "Duplicate namespaced tool: shared_echo"
      );
    } finally {
      await router.close();
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

function textContent(result: Awaited<ReturnType<GenericMcpRouter["callTool"]>>): string {
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
