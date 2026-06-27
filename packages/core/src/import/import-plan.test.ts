import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSwitchboardImportPlan,
  writeSwitchboardImportPlan
} from "./import-plan.js";

describe("switchboard import plan", () => {
  it("plans a cleanup from existing Codex and Claude MCP config without leaking secret values", async () => {
    const base = await mkdtemp(join(tmpdir(), "switchboard-import-"));
    const root = join(base, "stockr");
    await mkdir(root);
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.github]",
        'command = "docker"',
        'args = ["run", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"]',
        'env = { GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_should_not_print" }',
        "",
        "[mcp_servers.switchboard]",
        'command = "switchboard"',
        'args = ["--cwd", "/tmp/example", "mcp"]'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            vercel: {
              command: "npx",
              args: ["-y", "vercel-platform-mcp-server"],
              env: {
                VERCEL_TOKEN: "vercel_should_not_print"
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      join(root, ".env.local"),
      [
        "STRIPE_SECRET_KEY=sk_live_should_not_print",
        "NEXT_PUBLIC_POSTHOG_KEY=phc_should_not_print"
      ].join("\n"),
      "utf8"
    );

    const plan = await createSwitchboardImportPlan({ cwd: root });
    const serialized = JSON.stringify(plan);

    expect(plan.schemaVersion).toBe("switchboard.import-plan.v1");
    expect(plan.mode).toBe("dry-run");
    expect(plan.detected.clients.flatMap((client) => client.servers.map((server) => server.name))).toEqual([
      "github",
      "switchboard",
      "vercel"
    ]);
    expect(
      plan.actions
        .filter((action) => action.kind === "create-profile")
        .map((action) => action.profileName)
    ).toEqual(["github_stockr", "vercel_stockr"]);
    expect(
      plan.actions.some(
        (action) =>
          action.kind === "create-profile" &&
          action.serverName === "switchboard"
      )
    ).toBe(false);
    expect(plan.commands.secretCommands).toEqual([
      {
        command: "switchboard",
        args: [
          "secrets",
          "set",
          "github/stockr/dev/token",
          "--value-stdin"
        ]
      },
      {
        command: "switchboard",
        args: [
          "secrets",
          "set",
          "vercel/stockr/dev/token",
          "--value-stdin"
        ]
      }
    ]);
    expect(serialized).not.toContain("ghp_should_not_print");
    expect(serialized).not.toContain("vercel_should_not_print");
    expect(serialized).not.toContain("sk_live_should_not_print");
    expect(serialized).not.toContain("phc_should_not_print");
    expect(plan.warnings).toContain(
      "Existing MCP configs reference secret-looking env names; store values behind Switchboard local token aliases before routing agents."
    );
  });

  it("returns an import plan with an invalid client finding instead of throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-import-invalid-"));
    await writeFile(join(root, ".mcp.json"), "{ nope", "utf8");

    const plan = await createSwitchboardImportPlan({ cwd: root });

    expect(plan.ok).toBe(true);
    expect(plan.detected.clients.find((client) => client.client === "claude")).toMatchObject({
      status: "invalid"
    });
    expect(plan.warnings.some((warning) => warning.includes("claude config could not be parsed"))).toBe(true);
  });

  it("writes imported profiles to repo config with secretRefs and backs up existing config", async () => {
    const base = await mkdtemp(join(tmpdir(), "switchboard-import-write-"));
    const root = join(base, "stockr");
    await mkdir(root);
    await writeFile(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  existing_profile:",
        "    provider: fixture",
        "    namespace: existing_profile",
        "workspaces:",
        "  default:",
        "    paths:",
        "      - .",
        "    profiles:",
        "      - existing_profile"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            github: {
              command: "docker",
              args: ["run", "ghcr.io/github/github-mcp-server"],
              env: {
                GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_should_not_print"
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    const beforeClient = await readFile(join(root, ".mcp.json"), "utf8");

    const result = await writeSwitchboardImportPlan({
      cwd: root,
      now: new Date("2026-01-02T03:04:05.006Z")
    });
    const config = await readFile(join(root, ".switchboard.yaml"), "utf8");
    const afterClient = await readFile(join(root, ".mcp.json"), "utf8");
    const serialized = JSON.stringify(result);

    expect(result.action).toBe("updated");
    expect(result.backupPath).toBe(
      join(root, ".switchboard.yaml.switchboard-backup-20260102-030405006Z")
    );
    expect(result.createdProfiles).toEqual(["github_stockr"]);
    expect(config).toContain("github_stockr:");
    expect(config).toContain("secretRef: github/stockr/dev/token");
    expect(config).toContain("existing_profile");
    expect(afterClient).toBe(beforeClient);
    expect(serialized).not.toContain("ghp_should_not_print");
    expect(config).not.toContain("ghp_should_not_print");
  });
});
