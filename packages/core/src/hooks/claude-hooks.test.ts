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
