import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
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

  it("audits routed namespaced tool calls", async () => {
    const auditEntries: unknown[] = [];
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      }
    });

    try {
      await router.discoverTools();
      await router.callTool("alpha_tools_echo", { message: "hello" });

      expect(auditEntries).toMatchObject([
        {
          action: "tool_call",
          status: "ok",
          profileName: "alpha",
          namespace: "alpha_tools",
          toolName: "alpha_tools_echo",
          upstreamName: "echo"
        }
      ]);
    } finally {
      await router.close();
    }
  });

  it("attaches mandate context to routed tool-call audit entries", async () => {
    const auditEntries: unknown[] = [];
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      mandateId: "fix-ci",
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      }
    });

    try {
      await router.discoverTools();
      await router.callTool("alpha_tools_echo", { message: "hello" });

      expect(auditEntries).toMatchObject([
        {
          action: "tool_call",
          status: "ok",
          mandateId: "fix-ci",
          profileName: "alpha",
          namespace: "alpha_tools",
          toolName: "alpha_tools_echo"
        }
      ]);
    } finally {
      await router.close();
    }
  });

  it("denies routed tool calls outside the mandate allow list", async () => {
    const auditEntries: unknown[] = [];
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      mandateId: "fix-ci",
      toolPolicy: {
        allowedTools: ["alpha_tools_echo"]
      },
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      }
    });

    try {
      await router.discoverTools();
      await expect(router.callTool("alpha_tools_whoami")).rejects.toThrow(
        'tool "alpha_tools_whoami" is not allowed by mandate policy'
      );

      expect(auditEntries).toMatchObject([
        {
          action: "tool_call",
          status: "error",
          mandateId: "fix-ci",
          profileName: "alpha",
          namespace: "alpha_tools",
          toolName: "alpha_tools_whoami",
          upstreamName: "whoami",
          error: 'tool "alpha_tools_whoami" is not allowed by mandate policy'
        }
      ]);
    } finally {
      await router.close();
    }
  });

  it("filters discovered tools through mandate policy", async () => {
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      toolPolicy: {
        allowedTools: ["alpha_tools_echo"]
      }
    });

    try {
      const tools = await router.discoverTools();
      expect(tools.map((tool) => tool.name)).toEqual(["alpha_tools_echo"]);
    } finally {
      await router.close();
    }
  });

  it("blocks approval-gated tool calls with audit metadata", async () => {
    const auditEntries: unknown[] = [];
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      mandateId: "fix-ci",
      toolPolicy: {
        allowedTools: ["alpha_tools_*"],
        approvalGates: [{ id: "gate-1", toolPattern: "alpha_tools_echo" }]
      },
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      }
    });

    try {
      const tools = await router.discoverTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "alpha_tools_echo",
        "alpha_tools_whoami"
      ]);
      expect(tools.find((tool) => tool.name === "alpha_tools_echo")).toMatchObject({
        _meta: {
          switchboard: {
            approvalRequired: {
              gateId: "gate-1",
              toolPattern: "alpha_tools_echo"
            }
          }
        }
      });
      await expect(
        router.callTool("alpha_tools_echo", { message: "hello" })
      ).rejects.toThrow(
        'tool "alpha_tools_echo" requires approval by mandate gate "gate-1"'
      );

      expect(auditEntries).toMatchObject([
        {
          action: "tool_call",
          status: "error",
          mandateId: "fix-ci",
          profileName: "alpha",
          namespace: "alpha_tools",
          toolName: "alpha_tools_echo",
          upstreamName: "echo",
          approvalGateId: "gate-1",
          approvalGatePattern: "alpha_tools_echo",
          error:
            'tool "alpha_tools_echo" requires approval by mandate gate "gate-1"'
        }
      ]);
    } finally {
      await router.close();
    }
  });

  it("does not discover approval-gated tools outside the mandate allow list", async () => {
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      mandateId: "fix-ci",
      toolPolicy: {
        allowedTools: ["alpha_tools_whoami"],
        approvalGates: [{ id: "gate-1", toolPattern: "alpha_tools_echo" }],
        approvedApprovalRequests: [
          {
            id: "approval-1",
            approvalGateId: "gate-1",
            toolName: "alpha_tools_echo"
          }
        ]
      }
    });

    try {
      const tools = await router.discoverTools();
      expect(tools.map((tool) => tool.name)).toEqual(["alpha_tools_whoami"]);
      await expect(
        router.callTool("alpha_tools_echo", { message: "hello" })
      ).rejects.toThrow(
        'tool "alpha_tools_echo" is not allowed by mandate policy'
      );
    } finally {
      await router.close();
    }
  });

  it("keeps approval request audit linkage when approved gated calls fail upstream", async () => {
    const auditEntries: unknown[] = [];
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      mandateId: "fix-ci",
      toolPolicy: {
        allowedTools: ["alpha_tools_*"],
        approvalGates: [{ id: "gate-1", toolPattern: "alpha_tools_echo" }],
        approvedApprovalRequests: [
          {
            id: "approval-1",
            approvalGateId: "gate-1",
            toolName: "alpha_tools_echo"
          }
        ]
      },
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      }
    });

    try {
      await router.discoverTools();
      const connections = (
        router as unknown as {
          connections: Map<string, { callTool: GenericMcpRouter["callTool"] }>;
        }
      ).connections;
      const connection = connections.get("alpha");
      if (!connection) {
        throw new Error("alpha connection was not created");
      }
      vi.spyOn(connection, "callTool").mockRejectedValue(new Error("upstream died"));

      await expect(
        router.callTool("alpha_tools_echo", { message: "hello" })
      ).rejects.toThrow("upstream died");

      expect(auditEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "tool_call",
            status: "error",
            mandateId: "fix-ci",
            profileName: "alpha",
            namespace: "alpha_tools",
            toolName: "alpha_tools_echo",
            upstreamName: "echo",
            approvalRequestId: "approval-1"
          })
        ])
      );
    } finally {
      await router.close();
    }
  });

  it("lets deny patterns win over allow patterns", async () => {
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      toolPolicy: {
        allowedTools: ["alpha_tools_*"],
        deniedTools: ["*_echo"]
      }
    });

    try {
      await router.discoverTools();
      await expect(
        router.callTool("alpha_tools_echo", { message: "hello" })
      ).rejects.toThrow('tool "alpha_tools_echo" is denied by mandate policy');
    } finally {
      await router.close();
    }
  });

  it("does not audit unknown local routes", async () => {
    const auditEntries: unknown[] = [];
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      }
    });

    try {
      await router.discoverTools();
      await expect(router.callTool("alpha_tools_missing")).rejects.toThrow();

      expect(auditEntries).toEqual([]);
    } finally {
      await router.close();
    }
  });

  it("does not fail successful routed calls when audit logging fails", async () => {
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      auditLogger: {
        async log() {
          throw new Error("audit unavailable");
        }
      }
    });

    try {
      await router.discoverTools();
      await expect(
        router.callTool("alpha_tools_echo", { message: "hello" })
      ).resolves.toBeDefined();
    } finally {
      await router.close();
    }
  });

  it("serves an empty tool list and rejects every call when denyAll is set", async () => {
    const auditEntries: unknown[] = [];
    const router = new GenericMcpRouter([fixtureProfile("alpha", "alpha_tools")], {
      denyAll: { reason: "no active pass; grant one with switchboard grant" },
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      }
    });

    try {
      // No upstream is touched: tools/list is empty even though a profile is
      // configured, and any call is rejected with the deny reason and audited.
      expect(await router.discoverTools()).toEqual([]);
      await expect(
        router.callTool("alpha_tools_echo", { message: "hello" })
      ).rejects.toThrow("no active pass; grant one with switchboard grant");

      expect(auditEntries).toEqual([
        expect.objectContaining({
          action: "tool_call",
          status: "error",
          toolName: "alpha_tools_echo",
          error: "no active pass; grant one with switchboard grant"
        })
      ]);
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
      await expect(router.callTool("shared_echo", { message: "still?" })).rejects.toThrow(
        'Unknown namespaced tool "shared_echo". Run discoverTools() first.'
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
