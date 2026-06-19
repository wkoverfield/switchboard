import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  profileConfigToStdioUpstream,
  testStdioUpstreamProfile,
  type StdioUpstreamProfile
} from "./stdio-upstream.js";

const fixtureServerPath = fileURLToPath(
  new URL("../../fixtures/echo-server.mjs", import.meta.url)
);

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

  it("tests a stdio upstream profile by listing tools", async () => {
    const result = await testStdioUpstreamProfile(
      fixtureProfile("profile_test", "profile_test_tools"),
      { timeoutMs: 5_000 }
    );

    expect(result).toMatchObject({
      ok: true,
      profileName: "profile_test",
      namespace: "profile_test_tools",
      toolCount: 2
    });
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "echo",
      "whoami"
    ]);
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
