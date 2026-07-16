import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectProjectClientConfig,
  inspectProjectClientConfigs,
  renderSwitchboardClientConfig,
  resolveClientConfigPath,
  resolveProjectClientConfigPath,
  rollbackSwitchboardClientConfig,
  validateSwitchboardClientConfigOptions,
  writeSwitchboardClientConfig
} from "./client-config.js";

describe("renderSwitchboardClientConfig", () => {
  it("renders Codex TOML for the daemon-backed Switchboard MCP adapter", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "codex",
      cwd: "/repo/switchboard"
    });

    expect(rendered).toEqual({
      client: "codex",
      serverName: "switchboard",
      target: "~/.codex/config.toml or .codex/config.toml",
      content: [
        '[mcp_servers."switchboard"]',
        'command = "switchboard"',
        'args = ["--cwd", "/repo/switchboard", "mcp"]',
        'cwd = "/repo/switchboard"',
        "startup_timeout_sec = 20",
        "tool_timeout_sec = 60"
      ].join("\n")
    });
  });

  it("renders Claude Code JSON for the daemon-backed Switchboard MCP adapter", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "claude",
      cwd: "/repo/switchboard"
    });

    expect(JSON.parse(rendered.content)).toEqual({
      mcpServers: {
        switchboard: {
          command: "switchboard",
          args: ["--cwd", "/repo/switchboard", "mcp"],
          env: {}
        }
      }
    });
  });

  it("escapes custom Codex server names and commands", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "codex",
      serverName: 'switch"board\\local',
      command: "/usr/local/bin/switchboard",
      commandArgs: ["/repo/switchboard/apps/cli/dist/index.js"],
      cwd: "/repo/with spaces"
    });

    expect(rendered.content).toContain('[mcp_servers."switch\\"board\\\\local"]');
    expect(rendered.content).toContain(
      'command = "/usr/local/bin/switchboard"'
    );
    expect(rendered.content).toContain(
      'args = ["/repo/switchboard/apps/cli/dist/index.js", "--cwd", "/repo/with spaces", "mcp"]'
    );
  });

  it("renders a user-scoped Codex entry with no --cwd and no cwd key", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "codex",
      cwd: "/repo/switchboard",
      scope: "user"
    });

    expect(rendered.content).toBe(
      [
        '[mcp_servers."switchboard"]',
        'command = "switchboard"',
        'args = ["mcp"]',
        "startup_timeout_sec = 20",
        "tool_timeout_sec = 60"
      ].join("\n")
    );
    expect(rendered.content).not.toContain("--cwd");
    expect(rendered.content).not.toContain("cwd =");
  });

  it("renders a user-scoped Claude entry with bare mcp args", () => {
    const rendered = renderSwitchboardClientConfig({
      client: "claude",
      cwd: "/repo/switchboard",
      scope: "user"
    });

    expect(JSON.parse(rendered.content)).toEqual({
      mcpServers: {
        switchboard: {
          command: "switchboard",
          args: ["mcp"],
          env: {}
        }
      }
    });
  });

  it("rejects empty and control-character config values", () => {
    expect(
      validateSwitchboardClientConfigOptions({
        client: "codex",
        serverName: "switchboard\nlocal",
        command: "",
        cwd: "/repo"
      })
    ).toEqual({
      ok: false,
      errors: [
        "server name must not contain control characters",
        "command must not be empty"
      ]
    });

    expect(() =>
      renderSwitchboardClientConfig({
        client: "codex",
        serverName: "\n",
        cwd: "/repo"
      })
    ).toThrow(
      [
        "server name must not be empty",
        "server name must not contain control characters"
      ].join("\n")
    );
  });
});

describe("writeSwitchboardClientConfig", () => {
  it("writes a new project-scoped Codex config without a backup", async () => {
    const root = await makeTempProject();

    const result = await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root
    });

    const targetPath = join(root, ".codex", "config.toml");
    expect(result).toEqual({
      client: "codex",
      scope: "project",
      serverName: "switchboard",
      targetPath,
      backupPath: null,
      action: "created"
    });
    expect(readFileSync(targetPath, "utf8")).toContain(
      'args = ["--cwd", "' + root + '", "mcp"]'
    );
  });

  it("updates an existing Codex section and preserves other sections", async () => {
    const root = await makeTempProject();
    const targetPath = resolveProjectClientConfigPath("codex", root);
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      targetPath,
      [
        '[mcp_servers."other"]',
        'command = "other"',
        "",
        '[mcp_servers."switchboard"]',
        'command = "old"',
        'args = ["serve"]',
        "",
        "[profiles.default]",
        'model = "gpt-5"'
      ].join("\n")
    );

    const result = await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root,
      now: new Date("2026-06-19T16:00:00.000Z")
    });

    expect(result.action).toBe("updated");
    expect(result.backupPath).toBe(
      `${targetPath}.switchboard-backup-20260619-160000000Z`
    );
    const content = readFileSync(targetPath, "utf8");
    expect(content).toContain('[mcp_servers."other"]');
    expect(content).toContain('[mcp_servers."switchboard"]');
    expect(content).toContain(`args = ["--cwd", "${root}", "mcp"]`);
    expect(content).not.toContain('args = ["serve"]');
    expect(content).toContain("[profiles.default]");
    expect(readFileSync(result.backupPath ?? "", "utf8")).toContain(
      'command = "old"'
    );

    const secondResult = await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root,
      now: new Date("2026-06-19T16:00:00.000Z")
    });

    expect(secondResult.backupPath).toBe(
      `${targetPath}.switchboard-backup-20260619-160000000Z-1`
    );
  });

  it("updates an existing Codex section with an unquoted server name", async () => {
    const root = await makeTempProject();
    const targetPath = resolveProjectClientConfigPath("codex", root);
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      targetPath,
      [
        "[mcp_servers.switchboard]",
        'command = "old"',
        'args = ["serve"]'
      ].join("\n")
    );

    await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root
    });

    const content = readFileSync(targetPath, "utf8");
    expect(content).not.toContain("[mcp_servers.switchboard]");
    expect(content).toContain('[mcp_servers."switchboard"]');
    expect(content).toContain(`args = ["--cwd", "${root}", "mcp"]`);
  });

  it("merges Claude project config and backs up the previous file", async () => {
    const root = await makeTempProject();
    const targetPath = resolveProjectClientConfigPath("claude", root);
    writeFileSync(
      targetPath,
      JSON.stringify(
        {
          otherSetting: true,
          mcpServers: {
            existing: {
              command: "existing"
            }
          }
        },
        null,
        2
      )
    );

    const result = await writeSwitchboardClientConfig({
      client: "claude",
      cwd: root,
      now: new Date("2026-06-19T16:01:00.000Z")
    });

    expect(result.backupPath).toBe(
      `${targetPath}.switchboard-backup-20260619-160100000Z`
    );
    expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual({
      otherSetting: true,
      mcpServers: {
        existing: {
          command: "existing"
        },
        switchboard: {
          command: "switchboard",
          args: ["--cwd", root, "mcp"],
          env: {}
        }
      }
    });
  });
});

describe("rollbackSwitchboardClientConfig", () => {
  it("restores a project client config from a backup", async () => {
    const root = await makeTempProject();
    const targetPath = resolveProjectClientConfigPath("claude", root);
    const backupPath = join(root, "claude.backup.json");
    writeFileSync(targetPath, '{"current":true}\n');
    writeFileSync(backupPath, '{"restored":true}\n');

    const result = await rollbackSwitchboardClientConfig({
      client: "claude",
      cwd: root,
      backupPath,
      now: new Date("2026-06-19T16:02:00.000Z")
    });

    expect(result).toEqual({
      client: "claude",
      scope: "project",
      targetPath,
      restoredFrom: backupPath,
      backupPath: `${targetPath}.switchboard-backup-20260619-160200000Z`
    });
    expect(readFileSync(targetPath, "utf8")).toBe('{"restored":true}\n');
    expect(readFileSync(result.backupPath ?? "", "utf8")).toBe(
      '{"current":true}\n'
    );
  });
});

describe("inspectProjectClientConfig", () => {
  it("reports missing project client configs", async () => {
    const root = await makeTempProject();

    await expect(inspectProjectClientConfigs({ cwd: root })).resolves.toEqual([
      {
        client: "codex",
        scope: "project",
        serverName: "switchboard",
        targetPath: join(root, ".codex", "config.toml"),
        status: "missing",
        message: "Project client config file was not found.",
        otherServerNames: [],
        launch: null
      },
      {
        client: "claude",
        scope: "project",
        serverName: "switchboard",
        targetPath: join(root, ".mcp.json"),
        status: "missing",
        message: "Project client config file was not found.",
        otherServerNames: [],
        launch: null
      }
    ]);
  });

  it("reports installed Codex and Claude project configs", async () => {
    const root = await makeTempProject();
    await writeSwitchboardClientConfig({ client: "codex", cwd: root });
    await writeSwitchboardClientConfig({ client: "claude", cwd: root });

    await expect(inspectProjectClientConfigs({ cwd: root })).resolves.toEqual([
      {
        client: "codex",
        scope: "project",
        serverName: "switchboard",
        targetPath: join(root, ".codex", "config.toml"),
        status: "installed",
        message: "Codex project config routes through switchboard mcp.",
        otherServerNames: [],
        launch: {
          command: "switchboard",
          args: ["--cwd", root, "mcp"]
        }
      },
      {
        client: "claude",
        scope: "project",
        serverName: "switchboard",
        targetPath: join(root, ".mcp.json"),
        status: "installed",
        message: "Claude project config routes through switchboard mcp.",
        otherServerNames: [],
        launch: {
          command: "switchboard",
          args: ["--cwd", root, "mcp"]
        }
      }
    ]);
  });

  it("reports semantically equivalent project configs as installed", async () => {
    const root = await makeTempProject();
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        '[mcp_servers."switchboard"]',
        'command = "switchboard"',
        `args = ["--cwd", "${root}", "mcp"]`
      ].join("\n")
    );
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            switchboard: {
              env: {
                EXTRA: "ok"
              },
              args: ["--cwd", root, "mcp"],
              command: "switchboard"
            }
          }
        },
        null,
        2
      )
    );

    await expect(inspectProjectClientConfigs({ cwd: root })).resolves.toEqual([
      expect.objectContaining({ client: "codex", status: "installed" }),
      expect.objectContaining({ client: "claude", status: "installed" })
    ]);
  });

  it("reports other project MCP server names", async () => {
    const root = await makeTempProject();
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.github]",
        'command = "github-mcp"',
        "",
        '[mcp_servers."switchboard"]',
        'command = "switchboard"',
        `args = ["--cwd", "${root}", "mcp"]`
      ].join("\n")
    );
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          linear: {
            command: "linear-mcp"
          },
          switchboard: {
            command: "switchboard",
            args: ["--cwd", root, "mcp"]
          }
        }
      })
    );

    await expect(inspectProjectClientConfigs({ cwd: root })).resolves.toEqual([
      expect.objectContaining({
        client: "codex",
        status: "installed",
        otherServerNames: ["github"]
      }),
      expect.objectContaining({
        client: "claude",
        status: "installed",
        otherServerNames: ["linear"]
      })
    ]);
  });

  it("reports stale and invalid project client configs", async () => {
    const root = await makeTempProject();
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.switchboard]",
        'command = "switchboard"',
        'args = ["--cwd", "/old", "serve"]',
        'cwd = "/old"'
      ].join("\n")
    );
    writeFileSync(join(root, ".mcp.json"), "{not-json");

    const codex = await inspectProjectClientConfig({
      client: "codex",
      cwd: root
    });
    const claude = await inspectProjectClientConfig({
      client: "claude",
      cwd: root
    });

    expect(codex.status).toBe("stale");
    expect(codex.message).toContain("different Switchboard");
    expect(claude.status).toBe("invalid");
    expect(claude.message).toContain("JSON");
  });
});

describe("resolveClientConfigPath", () => {
  it("resolves project and user scope paths per client", () => {
    expect(
      resolveClientConfigPath({ client: "codex", cwd: "/repo" })
    ).toBe(join("/repo", ".codex", "config.toml"));
    expect(
      resolveClientConfigPath({ client: "claude", scope: "project", cwd: "/repo" })
    ).toBe(join("/repo", ".mcp.json"));
    expect(
      resolveClientConfigPath({
        client: "codex",
        scope: "user",
        cwd: "/repo",
        homeDir: "/home/dev",
        env: {}
      })
    ).toBe(join("/home/dev", ".codex", "config.toml"));
    expect(
      resolveClientConfigPath({
        client: "claude",
        scope: "user",
        cwd: "/repo",
        homeDir: "/home/dev",
        env: {}
      })
    ).toBe(join("/home/dev", ".claude.json"));
  });

  it("prefers CODEX_HOME for the user-scoped Codex config", () => {
    expect(
      resolveClientConfigPath({
        client: "codex",
        scope: "user",
        cwd: "/repo",
        homeDir: "/home/dev",
        env: { CODEX_HOME: "/custom/codex-home" }
      })
    ).toBe(join("/custom/codex-home", "config.toml"));
    expect(
      resolveClientConfigPath({
        client: "claude",
        scope: "user",
        cwd: "/repo",
        homeDir: "/home/dev",
        env: { CODEX_HOME: "/custom/codex-home" }
      })
    ).toBe(join("/home/dev", ".claude.json"));
  });
});

describe("user-scoped client config", () => {
  it("creates ~/.codex/config.toml under the given home directory", async () => {
    const homeDir = await makeTempHome();
    const root = await makeTempProject();

    const result = await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {}
    });

    const targetPath = join(homeDir, ".codex", "config.toml");
    expect(result).toEqual({
      client: "codex",
      scope: "user",
      serverName: "switchboard",
      targetPath,
      backupPath: null,
      action: "created"
    });
    const content = readFileSync(targetPath, "utf8");
    expect(content).toContain('args = ["mcp"]');
    expect(content).not.toContain("--cwd");
    expect(content).not.toContain("cwd =");
  });

  it("preserves unrelated user-level TOML sections and backs up updates", async () => {
    const homeDir = await makeTempHome();
    const root = await makeTempProject();
    const targetPath = join(homeDir, ".codex", "config.toml");
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    writeFileSync(
      targetPath,
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.github]",
        'command = "github-mcp"',
        "",
        '[projects."/repo/elsewhere"]',
        'trust_level = "trusted"'
      ].join("\n")
    );

    const result = await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {},
      now: new Date("2026-06-19T16:00:00.000Z")
    });

    expect(result.action).toBe("updated");
    expect(result.backupPath).toBe(
      `${targetPath}.switchboard-backup-20260619-160000000Z`
    );
    const content = readFileSync(targetPath, "utf8");
    expect(content).toContain('model = "gpt-5"');
    expect(content).toContain("[mcp_servers.github]");
    expect(content).toContain('[projects."/repo/elsewhere"]');
    expect(content).toContain('[mcp_servers."switchboard"]');
    expect(content).toContain('args = ["mcp"]');

    const rewrite = await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {},
      now: new Date("2026-06-19T16:01:00.000Z")
    });
    expect(rewrite.action).toBe("updated");
    expect(rewrite.backupPath).toBe(
      `${targetPath}.switchboard-backup-20260619-160100000Z`
    );
    expect(readFileSync(targetPath, "utf8")).toBe(content);
  });

  it("rolls back a user-scoped Codex config from a backup", async () => {
    const homeDir = await makeTempHome();
    const root = await makeTempProject();
    const targetPath = join(homeDir, ".codex", "config.toml");
    const backupPath = join(homeDir, "codex.backup.toml");
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    writeFileSync(targetPath, 'model = "current"\n');
    writeFileSync(backupPath, 'model = "restored"\n');

    const result = await rollbackSwitchboardClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {},
      backupPath,
      now: new Date("2026-06-19T16:02:00.000Z")
    });

    expect(result).toEqual({
      client: "codex",
      scope: "user",
      targetPath,
      restoredFrom: backupPath,
      backupPath: `${targetPath}.switchboard-backup-20260619-160200000Z`
    });
    expect(readFileSync(targetPath, "utf8")).toBe('model = "restored"\n');
    expect(readFileSync(result.backupPath ?? "", "utf8")).toBe(
      'model = "current"\n'
    );
  });

  it("inspects user-scoped Codex config states", async () => {
    const homeDir = await makeTempHome();
    const root = await makeTempProject();

    const missing = await inspectProjectClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {}
    });
    expect(missing).toMatchObject({
      client: "codex",
      scope: "user",
      status: "missing",
      targetPath: join(homeDir, ".codex", "config.toml")
    });

    await writeSwitchboardClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {}
    });
    const installed = await inspectProjectClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {}
    });
    expect(installed).toMatchObject({
      client: "codex",
      scope: "user",
      status: "installed",
      message: "Codex user config routes through switchboard mcp.",
      launch: { command: "switchboard", args: ["mcp"] }
    });
  });

  it("reports a user-scoped Codex entry with a pinned cwd as stale", async () => {
    const homeDir = await makeTempHome();
    const root = await makeTempProject();
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    writeFileSync(
      join(homeDir, ".codex", "config.toml"),
      [
        "[mcp_servers.github]",
        'command = "github-mcp"',
        "",
        '[mcp_servers."switchboard"]',
        'command = "switchboard"',
        'args = ["mcp"]',
        'cwd = "/repo/pinned"'
      ].join("\n")
    );

    const inspection = await inspectProjectClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {}
    });

    expect(inspection).toMatchObject({
      client: "codex",
      scope: "user",
      status: "stale",
      message: "Codex user config has a different Switchboard MCP server entry.",
      otherServerNames: ["github"]
    });
  });

  it("accepts user-scoped launch args with launcher prefixes", async () => {
    const homeDir = await makeTempHome();
    const root = await makeTempProject();
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    writeFileSync(
      join(homeDir, ".codex", "config.toml"),
      [
        '[mcp_servers."switchboard"]',
        'command = "/usr/local/bin/node"',
        'args = ["/opt/switchboard/dist/index.js", "mcp"]'
      ].join("\n")
    );

    const inspection = await inspectProjectClientConfig({
      client: "codex",
      cwd: root,
      scope: "user",
      homeDir,
      env: {}
    });

    expect(inspection).toMatchObject({
      client: "codex",
      scope: "user",
      status: "installed"
    });
  });
});

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switchboard-install-"));
}

async function makeTempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switchboard-install-home-"));
}
