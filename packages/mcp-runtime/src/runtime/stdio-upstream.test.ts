import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  profileConfigToStdioUpstream,
  profileConfigToStdioUpstreamWithSecrets,
  testStdioUpstreamProfile,
  type StdioUpstreamProfile
} from "./stdio-upstream.js";

const fixtureServerPath = fileURLToPath(
  new URL("../../fixtures/echo-server.mjs", import.meta.url)
);
const hangServerPath = fileURLToPath(
  new URL("../../fixtures/hang-server.mjs", import.meta.url)
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

  it("resolves relative upstream cwd against a supplied base directory", () => {
    expect(
      profileConfigToStdioUpstream(
        "relative_cwd",
        {
          provider: "generic",
          readOnly: false,
          upstream: {
            type: "stdio",
            command: "node",
            cwd: "tools",
            args: ["server.mjs"]
          }
        },
        { cwdBase: "/repo" }
      )
    ).toMatchObject({
      cwd: "/repo/tools"
    });
  });

  it("resolves secretRef env values only when a secret store is supplied", async () => {
    await expect(
      profileConfigToStdioUpstreamWithSecrets(
        "secret_profile",
        {
          provider: "generic",
          readOnly: false,
          upstream: {
            type: "stdio",
            command: "node",
            env: {
              API_TOKEN: { secretRef: "github/findu/dev/token" },
              LOG_LEVEL: "debug"
            }
          }
        },
        {
          secretStore: {
            async get(ref) {
              return ref === "github/findu/dev/token" ? "ghp_secret" : null;
            },
            async set() {},
            async delete() {}
          }
        }
      )
    ).resolves.toMatchObject({
      env: {
        API_TOKEN: "ghp_secret",
        LOG_LEVEL: "debug"
      }
    });

    expect(() =>
      profileConfigToStdioUpstream("secret_profile", {
        provider: "generic",
        readOnly: false,
        upstream: {
          type: "stdio",
          command: "node",
          env: {
            API_TOKEN: { secretRef: "github/findu/dev/token" }
          }
        }
      })
    ).toThrow(/resolve secrets/);
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

  it("times out and cleans up a profile that never initializes", async () => {
    const root = mkdtempSync(join(tmpdir(), "switchboard-hang-"));
    const pidFile = join(root, "pid");

    try {
      await expect(
        testStdioUpstreamProfile(
          {
            profileName: "hang",
            namespace: "hang",
            command: process.execPath,
            args: [hangServerPath, pidFile]
          },
          { timeoutMs: 500 }
        )
      ).rejects.toThrow();

      const pid = Number(readFileSync(pidFile, "utf8"));
      await expectProcessToExit(pid);
    } finally {
      rmSync(root, { recursive: true, force: true });
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

async function expectProcessToExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Expected process ${pid} to exit`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
