import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeHookCommandFromLaunch,
  defaultClaudeHookCommand,
  inspectClaudeHooks,
  installClaudeHooks,
  resolveClaudeConfigDir,
  resolveClaudeUserSettingsPath,
  uninstallClaudeHooks
} from "./claude-hooks.js";

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switchboard-claude-hooks-"));
}

describe("claude hooks install and uninstall", () => {
  it("creates settings from nothing and removes them byte-identically", async () => {
    const homeDir = await makeHome();
    const installed = await installClaudeHooks({ homeDir });
    expect(installed.action).toBe("created");
    expect(installed.backupPath).toBeNull();
    expect(installed.targetPath).toBe(
      join(homeDir, ".claude", "settings.json")
    );

    const written = JSON.parse(
      await readFile(installed.targetPath, "utf8")
    ) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: unknown[] }> };
    };
    expect(written.hooks.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: defaultClaudeHookCommand }]
      }
    ]);

    const removed = await uninstallClaudeHooks({ homeDir });
    expect(removed.action).toBe("removed");
    expect(removed.backupPath).not.toBeNull();
    // Pre-install there was no settings file; uninstall restores that state.
    expect(existsSync(installed.targetPath)).toBe(false);
  });

  it("merges into existing settings and restores them byte-identically", async () => {
    const homeDir = await makeHome();
    const targetPath = resolveClaudeUserSettingsPath({ homeDir });
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    const original = `${JSON.stringify(
      {
        model: "opus",
        permissions: { allow: ["Bash(pnpm:*)"] },
        hooks: {
          PreToolUse: [
            {
              matcher: "WebFetch",
              hooks: [{ type: "command", command: "/usr/local/bin/my-hook" }]
            }
          ]
        }
      },
      null,
      2
    )}\n`;
    await writeFile(targetPath, original);

    const installed = await installClaudeHooks({ homeDir });
    expect(installed.action).toBe("updated");
    expect(installed.backupPath).not.toBeNull();
    const merged = JSON.parse(await readFile(targetPath, "utf8")) as {
      model: string;
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    expect(merged.model).toBe("opus");
    expect(merged.hooks.PreToolUse).toHaveLength(2);
    expect(merged.hooks.PreToolUse[0]?.matcher).toBe("WebFetch");
    expect(merged.hooks.PreToolUse[1]?.matcher).toBe("Bash");

    const removed = await uninstallClaudeHooks({ homeDir });
    expect(removed.action).toBe("removed");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(original);
  });

  it("is idempotent: a second install is a noop without a backup", async () => {
    const homeDir = await makeHome();
    await installClaudeHooks({ homeDir });
    const again = await installClaudeHooks({ homeDir });
    expect(again.action).toBe("noop");
    expect(again.backupPath).toBeNull();
  });

  it("replaces a stale switchboard hook command instead of stacking", async () => {
    const homeDir = await makeHome();
    await installClaudeHooks({
      homeDir,
      hookCommand: "node /old/path/index.js hooks check"
    });
    const updated = await installClaudeHooks({ homeDir });
    expect(updated.action).toBe("updated");

    const inspection = await inspectClaudeHooks({ homeDir });
    expect(inspection.status).toBe("installed");
    expect(inspection.hookCommands).toEqual([defaultClaudeHookCommand]);
  });

  it("uninstall is a noop when nothing switchboard-owned is present", async () => {
    const homeDir = await makeHome();
    const targetPath = resolveClaudeUserSettingsPath({ homeDir });
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    const original = `${JSON.stringify({ model: "opus" }, null, 2)}\n`;
    await writeFile(targetPath, original);

    const removed = await uninstallClaudeHooks({ homeDir });
    expect(removed.action).toBe("noop");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(original);
  });

  it("fails closed on unparseable settings instead of clobbering them", async () => {
    const homeDir = await makeHome();
    const targetPath = resolveClaudeUserSettingsPath({ homeDir });
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    await writeFile(targetPath, "{not json");

    await expect(installClaudeHooks({ homeDir })).rejects.toThrow(
      /not valid JSON/
    );
    await expect(readFile(targetPath, "utf8")).resolves.toBe("{not json");
  });

  it("rejects hook commands uninstall could not identify", async () => {
    const homeDir = await makeHome();
    await expect(
      installClaudeHooks({ homeDir, hookCommand: "rm -rf /" })
    ).rejects.toThrow(/hooks check/);
  });
});

describe("claudeHookCommandFromLaunch", () => {
  it("renders a global binary launch", () => {
    expect(
      claudeHookCommandFromLaunch({ command: "switchboard" })
    ).toBe("switchboard hooks check");
  });

  it("quotes launcher paths with spaces", () => {
    expect(
      claudeHookCommandFromLaunch({
        command: "/usr/local/bin/node",
        commandArgs: ["/Users/w k/switchboard/dist/index.js"]
      })
    ).toBe(
      "/usr/local/bin/node '/Users/w k/switchboard/dist/index.js' hooks check"
    );
  });
});

describe("claude config dir resolution", () => {
  it("uses CLAUDE_CONFIG_DIR directly (settings.json at its top level)", () => {
    const env = { CLAUDE_CONFIG_DIR: "/home/alex/.claude-b" } as NodeJS.ProcessEnv;
    expect(resolveClaudeConfigDir({ env })).toBe("/home/alex/.claude-b");
    expect(resolveClaudeUserSettingsPath({ env })).toBe(
      "/home/alex/.claude-b/settings.json"
    );
  });

  it("lets an explicit config dir override CLAUDE_CONFIG_DIR", () => {
    const env = { CLAUDE_CONFIG_DIR: "/home/alex/.claude-b" } as NodeJS.ProcessEnv;
    expect(
      resolveClaudeUserSettingsPath({ env, claudeConfigDir: "/tmp/sandbox" })
    ).toBe("/tmp/sandbox/settings.json");
  });

  it("lets an injected home dir win over the ambient CLAUDE_CONFIG_DIR", () => {
    // A sandbox injection must never escape into the real config dir the
    // environment happens to point at.
    const env = { CLAUDE_CONFIG_DIR: "/home/alex/.claude-b" } as NodeJS.ProcessEnv;
    expect(resolveClaudeConfigDir({ env, homeDir: "/tmp/sandbox-home" })).toBe(
      "/tmp/sandbox-home/.claude"
    );
  });

  it("falls back to <homeDir>/.claude when no config dir is set", () => {
    expect(
      resolveClaudeUserSettingsPath({
        env: {} as NodeJS.ProcessEnv,
        homeDir: "/home/alex"
      })
    ).toBe("/home/alex/.claude/settings.json");
  });

  it("installs into an explicit config dir and never the env or home fallback", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "switchboard-cfgdir-"));
    const envDir = await mkdtemp(join(tmpdir(), "switchboard-envdir-"));
    const installed = await installClaudeHooks({
      claudeConfigDir: configDir,
      env: { CLAUDE_CONFIG_DIR: envDir } as NodeJS.ProcessEnv
    });
    expect(installed.targetPath).toBe(join(configDir, "settings.json"));
    expect(existsSync(installed.targetPath)).toBe(true);
    // The env-pointed dir was not written (explicit override won).
    expect(existsSync(join(envDir, "settings.json"))).toBe(false);

    const removed = await uninstallClaudeHooks({ claudeConfigDir: configDir });
    expect(removed.action).toBe("removed");
    expect(existsSync(installed.targetPath)).toBe(false);
  });
});
