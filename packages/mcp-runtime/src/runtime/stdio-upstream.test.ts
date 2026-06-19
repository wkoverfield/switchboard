import { describe, expect, it } from "vitest";
import { profileConfigToStdioUpstream } from "./stdio-upstream.js";

describe("profileConfigToStdioUpstream", () => {
  it("converts a stdio profile config into a runtime upstream profile", () => {
    expect(
      profileConfigToStdioUpstream("Fixture Profile", {
        provider: "generic",
        readOnly: false,
        upstream: {
          type: "stdio",
          command: "node",
          args: ["fixture.mjs"],
          cwd: ".",
          env: {
            FIXTURE: "ok"
          }
        }
      })
    ).toEqual({
      profileName: "Fixture Profile",
      namespace: "fixture_profile",
      command: "node",
      args: ["fixture.mjs"],
      cwd: ".",
      env: {
        FIXTURE: "ok"
      }
    });
  });

  it("skips non-stdio profile configs", () => {
    expect(
      profileConfigToStdioUpstream("http", {
        provider: "generic",
        readOnly: false,
        upstream: {
          type: "streamable-http",
          url: "https://example.com/mcp"
        }
      })
    ).toBeUndefined();
  });
});
