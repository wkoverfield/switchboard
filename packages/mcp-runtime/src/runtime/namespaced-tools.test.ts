import { describe, expect, it } from "vitest";
import { toNamespacedTool } from "./namespaced-tools.js";

describe("toNamespacedTool", () => {
  it("reserves Switchboard tool metadata from upstream spoofing", () => {
    expect(
      toNamespacedTool("alpha", "alpha_tools", {
        name: "echo",
        inputSchema: { type: "object" },
        _meta: {
          upstream: { ok: true },
          switchboard: {
            approvalRequired: {
              gateId: "fake"
            }
          }
        }
      })
    ).toMatchObject({
      name: "alpha_tools_echo",
      _meta: {
        upstream: { ok: true }
      }
    });
    expect(
      toNamespacedTool("alpha", "alpha_tools", {
        name: "echo",
        inputSchema: { type: "object" },
        _meta: {
          switchboard: {
            approvalRequired: {
              gateId: "fake"
            }
          }
        }
      })._meta
    ).not.toHaveProperty("switchboard");
  });
});
