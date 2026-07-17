import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadSwitchboardConfig } from "../config/load-config.js";
import { writeGlobalSwitchboardConfig } from "./global-config.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "switchboard-global-config-"));
}

describe("writeGlobalSwitchboardConfig", () => {
  it("creates the config under XDG_CONFIG_HOME with an inert default policy stanza", async () => {
    const configHome = makeTempDir();
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;

    const result = await writeGlobalSwitchboardConfig({ env });

    expect(result.action).toBe("created");
    expect(result.backupPath).toBeNull();
    expect(result.hooks).toBe("enabled");
    expect(result.path).toBe(join(configHome, "switchboard", "config.yaml"));
    const content = readFileSync(result.path, "utf8");
    expect(content).toContain("policies:");
    expect(content).toContain("default: {}");
    expect(content).toContain("hooks: enabled");
    // The stanza carries a comment naming its schema so a reader can find it.
    expect(content).toContain("policySchema");
    const parsed = parseYaml(content) as {
      version: number;
      policies: Record<string, unknown>;
      setup: { hooks: string };
    };
    expect(parsed.version).toBe(1);
    expect(parsed.policies.default).toEqual({});
    expect(parsed.setup.hooks).toBe("enabled");
  });

  it("produces a file the config loader accepts without diagnostics", async () => {
    const configHome = makeTempDir();
    const cwd = makeTempDir();
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;

    await writeGlobalSwitchboardConfig({ env });
    const loaded = loadSwitchboardConfig({ cwd, env });

    expect(loaded.diagnostics).toEqual([]);
    expect(
      loaded.sources.find((source) => source.kind === "global")?.loaded
    ).toBe(true);
    expect(loaded.config.policies.default).toBeDefined();
  });

  it("falls back to ~/.config under the injected home directory", async () => {
    const homeDir = makeTempDir();

    const result = await writeGlobalSwitchboardConfig({
      homeDir,
      env: {} as NodeJS.ProcessEnv
    });

    expect(result.path).toBe(
      join(homeDir, ".config", "switchboard", "config.yaml")
    );
    expect(existsSync(result.path)).toBe(true);
  });

  it("is a noop on re-run and never re-backs-up an unchanged file", async () => {
    const configHome = makeTempDir();
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;

    const first = await writeGlobalSwitchboardConfig({ env });
    const before = readFileSync(first.path, "utf8");
    const second = await writeGlobalSwitchboardConfig({ env });

    expect(second.action).toBe("noop");
    expect(second.backupPath).toBeNull();
    expect(readFileSync(first.path, "utf8")).toBe(before);
    const siblings = readdirSync(join(configHome, "switchboard"));
    expect(siblings).toEqual(["config.yaml"]);
  });

  it("appends the managed sections to an existing hand-written file without clobbering it", async () => {
    const configHome = makeTempDir();
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;
    const dir = join(configHome, "switchboard");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "config.yaml");
    const original = [
      "# my machine config",
      "version: 1",
      "defaults:",
      "  defaultEnvironment: local",
      ""
    ].join("\n");
    writeFileSync(path, original);

    const result = await writeGlobalSwitchboardConfig({ env });

    expect(result.action).toBe("updated");
    expect(result.backupPath).not.toBeNull();
    expect(readFileSync(result.backupPath ?? "", "utf8")).toBe(original);
    const content = readFileSync(path, "utf8");
    // Existing text (including comments) is preserved verbatim.
    expect(content.startsWith(original)).toBe(true);
    const parsed = parseYaml(content) as {
      defaults: { defaultEnvironment: string };
      policies: Record<string, unknown>;
      setup: { hooks: string };
    };
    expect(parsed.defaults.defaultEnvironment).toBe("local");
    expect(parsed.policies.default).toEqual({});
    expect(parsed.setup.hooks).toBe("enabled");
  });

  it("preserves an existing default policy stanza when merging", async () => {
    const configHome = makeTempDir();
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;
    const dir = join(configHome, "switchboard");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "config.yaml");
    writeFileSync(
      path,
      ["version: 1", "policies:", "  default:", "    hideTools:", "      - deploy_prod", ""].join(
        "\n"
      )
    );

    const result = await writeGlobalSwitchboardConfig({ env });

    expect(result.action).toBe("updated");
    const parsed = parseYaml(readFileSync(path, "utf8")) as {
      policies: { default: { hideTools: string[] } };
      setup: { hooks: string };
    };
    expect(parsed.policies.default.hideTools).toEqual(["deploy_prod"]);
    expect(parsed.setup.hooks).toBe("enabled");
  });

  it("records hooks disabled and preserves that choice when hooks is omitted", async () => {
    const configHome = makeTempDir();
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;

    const first = await writeGlobalSwitchboardConfig({ env, hooks: "disabled" });
    expect(first.hooks).toBe("disabled");
    expect(readFileSync(first.path, "utf8")).toContain("hooks: disabled");

    const second = await writeGlobalSwitchboardConfig({ env });
    expect(second.action).toBe("noop");
    expect(second.hooks).toBe("disabled");

    const third = await writeGlobalSwitchboardConfig({ env, hooks: "enabled" });
    expect(third.action).toBe("updated");
    expect(third.hooks).toBe("enabled");
  });

  it("rejects a config file that is not a YAML mapping", async () => {
    const configHome = makeTempDir();
    const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;
    const dir = join(configHome, "switchboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.yaml"), "- not\n- a\n- mapping\n");

    await expect(writeGlobalSwitchboardConfig({ env })).rejects.toThrow(
      "must be a YAML mapping"
    );
  });
});
