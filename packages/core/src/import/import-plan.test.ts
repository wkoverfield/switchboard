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
        'args = ["run", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_TOKEN=ghp_arg_should_not_print", "ghcr.io/github/github-mcp-server"]',
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
              args: [
                "-y",
                "vercel-platform-mcp-server",
                "VERCEL_TOKEN=vercel_arg_should_not_print"
              ],
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
    expect(plan.recommendedNextAction.primary).toMatchObject({
      kind: "missing-secret",
      command:
        "switchboard secrets set github/stockr/dev/token --value-stdin"
    });
    expect(plan.recommendedNextAction.alternatives).toContainEqual(
      expect.objectContaining({
        kind: "bypass-cleanup",
        command: "switchboard import --write --cleanup-client"
      })
    );
    expect(serialized).not.toContain("ghp_should_not_print");
    expect(serialized).not.toContain("ghp_arg_should_not_print");
    expect(serialized).not.toContain("vercel_should_not_print");
    expect(serialized).not.toContain("vercel_arg_should_not_print");
    expect(serialized).not.toContain("sk_live_should_not_print");
    expect(serialized).not.toContain("phc_should_not_print");
    expect(serialized).toContain("GITHUB_TOKEN=[redacted]");
    expect(serialized).toContain("VERCEL_TOKEN=[redacted]");
    expect(plan.warnings).toContain(
      "Existing MCP configs reference secret-looking env names; store values behind Switchboard local token aliases before routing agents."
    );
    expect(plan.bypassFindings).toHaveLength(2);
    expect(plan.bypassFindings[0]).toMatchObject({
      id: "codex:github",
      status: "unaccepted",
      severity: "high",
      client: "codex",
      serverName: "github",
      provider: "github",
      riskTags: expect.arrayContaining([
        "direct-mcp-server",
        "switchboard-coexists",
        "secret-env-name",
        "token-like-arg"
      ])
    });
    expect(plan.bypassFindings[1]).toMatchObject({
      id: "claude:vercel",
      severity: "high",
      provider: "vercel"
    });
    expect(serialized).toContain(
      "Direct MCP servers bypass Switchboard authority"
    );
  });

  it("flags broad filesystem mounts as high-risk bypasses", async () => {
    const base = await mkdtemp(join(tmpdir(), "switchboard-import-fs-"));
    const root = join(base, "repo");
    await mkdir(root);
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/"]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const plan = await createSwitchboardImportPlan({ cwd: root });

    expect(plan.bypassFindings).toHaveLength(1);
    expect(plan.bypassFindings[0]).toMatchObject({
      severity: "high",
      riskTags: expect.arrayContaining(["broad-filesystem-mount"])
    });
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
              args: [
                "run",
                "GITHUB_TOKEN=ghp_write_should_not_print",
                "ghcr.io/github/github-mcp-server"
              ],
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
    expect(serialized).not.toContain("ghp_write_should_not_print");
    expect(config).not.toContain("ghp_should_not_print");
    expect(config).not.toContain("ghp_write_should_not_print");
    expect(config).toContain("GITHUB_TOKEN=[redacted]");
  });

  it("cleans direct client MCP bypass routes with backups and is idempotent", async () => {
    const base = await mkdtemp(join(tmpdir(), "switchboard-import-cleanup-"));
    const root = join(base, "stockr");
    await mkdir(root);
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_stockr_ci:",
        "    provider: github",
        "    namespace: github_stockr_ci",
        "    upstream:",
        "      type: stdio",
        "      command: docker"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.switchboard]",
        'command = "switchboard"',
        'args = ["--cwd", "/tmp/example", "mcp"]',
        "",
        "[mcp_servers.github]",
        'command = "docker"',
        'args = ["run", "GITHUB_TOKEN=ghp_cleanup_should_not_print", "ghcr.io/github/github-mcp-server"]',
        "[mcp_servers.github.env]",
        'GITHUB_TOKEN = "ghp_cleanup_should_not_print"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            switchboard: {
              command: "switchboard",
              args: ["--cwd", root, "mcp"]
            },
            vercel: {
              command: "npx",
              args: [
                "-y",
                "vercel-platform-mcp-server",
                "VERCEL_TOKEN=vercel_cleanup_should_not_print"
              ],
              env: {
                VERCEL_TOKEN: "vercel_cleanup_should_not_print"
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await writeSwitchboardImportPlan({
      cwd: root,
      cleanupClient: true,
      now: new Date("2026-02-03T04:05:06.007Z")
    });
    const codexConfig = await readFile(join(root, ".codex", "config.toml"), "utf8");
    const claudeConfig = await readFile(join(root, ".mcp.json"), "utf8");
    const serialized = JSON.stringify(result);

    expect(result.clientCleanup).toContainEqual(
      expect.objectContaining({
        client: "codex",
        status: "updated",
        backupPath: join(
          root,
          ".codex",
          "config.toml.switchboard-backup-20260203-040506007Z"
        ),
        affectedServerNames: ["github"]
      })
    );
    expect(result.clientCleanup).toContainEqual(
      expect.objectContaining({
        client: "claude",
        status: "updated",
        backupPath: join(
          root,
          ".mcp.json.switchboard-backup-20260203-040506007Z"
        ),
        affectedServerNames: ["vercel"]
      })
    );
    expect(codexConfig).toContain("[mcp_servers.switchboard]");
    expect(codexConfig).not.toContain("[mcp_servers.github]");
    expect(codexConfig).not.toContain("ghp_cleanup_should_not_print");
    expect(claudeConfig).toContain("switchboard");
    expect(claudeConfig).not.toContain("vercel");
    expect(claudeConfig).not.toContain("vercel_cleanup_should_not_print");
    expect(serialized).not.toContain("ghp_cleanup_should_not_print");
    expect(serialized).not.toContain("vercel_cleanup_should_not_print");

    const rerun = await writeSwitchboardImportPlan({
      cwd: root,
      cleanupClient: true
    });
    expect(rerun.clientCleanup.every((item) => item.status !== "updated")).toBe(true);
  });
});
