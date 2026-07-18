import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attenuationRewriteSpawnDecision,
  installClaudeAttenuation,
  inspectClaudeAttenuation,
  renderScopedWorkerAgentDefinition,
  resolveScopedWorkerAgentPath,
  scopedWorkerAgentName,
  uninstallClaudeAttenuation
} from "./claude-attenuation.js";
import { resolveClaudeUserSettingsPath } from "../hooks/claude-hooks.js";

function sandboxHome(): string {
  return mkdtempSync(join(tmpdir(), "switchboard-attenuation-home-"));
}

describe("claude spawn-time attenuation install", () => {
  it("writes the spawn-rewrite hook and the scoped-worker agent into a sandbox home", async () => {
    const homeDir = sandboxHome();
    const launch = { command: "switchboard" };

    const installed = await installClaudeAttenuation({ homeDir, launch });

    expect(installed.action).toBe("created");
    const settings = JSON.parse(
      readFileSync(installed.settingsPath, "utf8")
    ) as {
      hooks: {
        PreToolUse: Array<{
          matcher: string;
          hooks: Array<{ command: string }>;
        }>;
      };
    };
    const entry = settings.hooks.PreToolUse.find((candidate) =>
      candidate.hooks.some((hook) =>
        hook.command.endsWith("attenuation rewrite-spawn")
      )
    );
    expect(entry).toBeDefined();
    expect(entry?.matcher).toBe("Agent|Task");

    const agent = readFileSync(installed.agentPath, "utf8");
    expect(installed.agentPath).toBe(resolveScopedWorkerAgentPath({ homeDir }));
    expect(agent).toContain(`name: ${scopedWorkerAgentName}`);
    expect(agent).toContain("disallowedTools: mcp__switchboard");
    // The launcher mints a child at spawn time.
    expect(agent).toContain('"--mint-child"');

    const inspection = await inspectClaudeAttenuation({ homeDir });
    expect(inspection.status).toBe("installed");
  });

  it("merges beside an existing hook and restores byte-for-byte on uninstall", async () => {
    const homeDir = sandboxHome();
    const settingsPath = resolveClaudeUserSettingsPath({ homeDir });
    mkdirSync(join(homeDir, ".claude"), { recursive: true });
    // A pre-existing, canonically-formatted settings file with an unrelated
    // hook Switchboard must not disturb.
    const original = `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "my-own-hook" }]
            }
          ]
        }
      },
      null,
      2
    )}\n`;
    writeFileSync(settingsPath, original, "utf8");

    const installed = await installClaudeAttenuation({ homeDir });
    expect(installed.action).toBe("updated");
    expect(installed.settingsBackupPath).not.toBeNull();

    const merged = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    // The unrelated hook survives alongside the new Agent hook.
    expect(
      merged.hooks.PreToolUse.some((entry) => entry.matcher === "Bash")
    ).toBe(true);
    expect(
      merged.hooks.PreToolUse.some((entry) => entry.matcher === "Agent|Task")
    ).toBe(true);

    const removed = await uninstallClaudeAttenuation({ homeDir });
    expect(removed.action).toBe("removed");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
    // The Switchboard-authored agent definition is gone.
    expect(existsSync(removed.agentPath)).toBe(false);
  });

  it("removes the settings file entirely when install created it from nothing", async () => {
    const homeDir = sandboxHome();
    const installed = await installClaudeAttenuation({ homeDir });
    expect(installed.settingsBackupPath).toBeNull();

    await uninstallClaudeAttenuation({ homeDir });
    expect(existsSync(installed.settingsPath)).toBe(false);
    expect(existsSync(installed.agentPath)).toBe(false);

    const inspection = await inspectClaudeAttenuation({ homeDir });
    expect(inspection.status).toBe("missing");
  });

  it("refuses to clobber a foreign scoped-worker agent definition", async () => {
    const homeDir = sandboxHome();
    const agentPath = resolveScopedWorkerAgentPath({ homeDir });
    mkdirSync(join(homeDir, ".claude", "agents"), { recursive: true });
    writeFileSync(agentPath, "---\nname: scoped-worker\n---\nsomeone else's\n");

    await expect(installClaudeAttenuation({ homeDir })).rejects.toThrow(
      /was not written by Switchboard/
    );
  });

  it("is idempotent: a second install is a noop", async () => {
    const homeDir = sandboxHome();
    await installClaudeAttenuation({ homeDir });
    const second = await installClaudeAttenuation({ homeDir });
    expect(second.action).toBe("noop");
  });

  it("bakes the launcher command into the agent definition", () => {
    const rendered = renderScopedWorkerAgentDefinition({
      command: "/usr/bin/node",
      commandArgs: ["/repo/apps/cli/dist/index.js"]
    });
    expect(rendered).toContain('command: "/usr/bin/node"');
    expect(rendered).toContain('"/repo/apps/cli/dist/index.js"');
    expect(rendered).toContain('"mcp"');
    expect(rendered).toContain('"--mint-child"');
  });
});

describe("claude config dir for attenuation", () => {
  it("resolves the scoped-worker agent under CLAUDE_CONFIG_DIR directly", () => {
    const env = { CLAUDE_CONFIG_DIR: "/home/alex/.claude-b" } as NodeJS.ProcessEnv;
    expect(resolveScopedWorkerAgentPath({ env })).toBe(
      "/home/alex/.claude-b/agents/scoped-worker.md"
    );
  });

  it("installs and uninstalls under an explicit config dir, never the env dir", async () => {
    const configDir = sandboxHome();
    const envDir = sandboxHome();
    const installed = await installClaudeAttenuation({
      claudeConfigDir: configDir,
      env: { CLAUDE_CONFIG_DIR: envDir } as NodeJS.ProcessEnv
    });
    expect(installed.settingsPath).toBe(join(configDir, "settings.json"));
    expect(installed.agentPath).toBe(
      join(configDir, "agents", "scoped-worker.md")
    );
    expect(existsSync(installed.settingsPath)).toBe(true);
    expect(existsSync(installed.agentPath)).toBe(true);
    // The env-pointed dir was untouched (explicit override won).
    expect(existsSync(join(envDir, "settings.json"))).toBe(false);
    expect(existsSync(join(envDir, "agents", "scoped-worker.md"))).toBe(false);

    const removed = await uninstallClaudeAttenuation({
      claudeConfigDir: configDir
    });
    expect(removed.action).toBe("removed");
    expect(existsSync(installed.settingsPath)).toBe(false);
    expect(existsSync(installed.agentPath)).toBe(false);
  });
});

describe("spawn-rewrite decision", () => {
  it("redirects a generic subagent spawn to the scoped worker", () => {
    const decision = attenuationRewriteSpawnDecision({
      tool_name: "Agent",
      tool_input: { subagent_type: "general-purpose", prompt: "do a thing" }
    });
    expect(decision?.hookSpecificOutput.updatedInput).toMatchObject({
      subagent_type: "scoped-worker",
      prompt: "do a thing"
    });
    expect(decision?.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("treats a missing subagent_type as the default generic spawn", () => {
    const decision = attenuationRewriteSpawnDecision({
      tool_name: "Agent",
      tool_input: { prompt: "x" }
    });
    expect(decision?.hookSpecificOutput.updatedInput.subagent_type).toBe(
      "scoped-worker"
    );
  });

  it("leaves a specialized subagent type untouched", () => {
    expect(
      attenuationRewriteSpawnDecision({
        tool_name: "Agent",
        tool_input: { subagent_type: "code-reviewer" }
      })
    ).toBeNull();
  });

  it("does not re-redirect an already-scoped spawn", () => {
    expect(
      attenuationRewriteSpawnDecision({
        tool_name: "Agent",
        tool_input: { subagent_type: "scoped-worker" }
      })
    ).toBeNull();
  });

  it("returns null on malformed input rather than throwing", () => {
    expect(attenuationRewriteSpawnDecision({})).toBeNull();
    expect(
      attenuationRewriteSpawnDecision({ tool_input: "nonsense" })
    ).toBeNull();
  });
});
