import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSwitchboardConfig } from "./load-config.js";
import { resolveGlobalConfigPath } from "./paths.js";

describe("loadSwitchboardConfig", () => {
  it("applies precedence from global to repo to local to env to cli", () => {
    const root = makeTempProject();
    const home = join(root, "home");
    const repo = join(root, "repo");
    mkdirSync(home, { recursive: true });
    mkdirSync(repo, { recursive: true });

    const env = {
      XDG_CONFIG_HOME: join(root, "xdg"),
      SWITCHBOARD_DEFAULT_ENVIRONMENT: "staging"
    };
    const globalPath = resolveGlobalConfigPath({ env, homeDir: home });
    mkdirSync(join(globalPath, ".."), { recursive: true });
    writeFileSync(
      globalPath,
      [
        "version: 1",
        "defaults:",
        "  defaultEnvironment: development",
        "profiles:",
        "  api:",
        "    provider: generic",
        "    environment: development"
      ].join("\n")
    );

    writeFileSync(
      join(repo, ".switchboard.yaml"),
      [
        "version: 1",
        "defaults:",
        "  defaultEnvironment: production",
        "profiles:",
        "  web:",
        "    provider: generic",
        "    environment: production"
      ].join("\n")
    );

    writeFileSync(
      join(repo, ".switchboard.local.yaml"),
      [
        "version: 1",
        "profiles:",
        "  web:",
        "    provider: generic",
        "    environment: local"
      ].join("\n")
    );

    const loaded = loadSwitchboardConfig({
      cwd: repo,
      env,
      homeDir: home,
      cliOverrides: {
        defaults: {
          activeProfile: "web"
        }
      }
    });

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.config.defaults.defaultEnvironment).toBe("staging");
    expect(loaded.config.defaults.activeProfile).toBe("web");
    expect(loaded.config.profiles.api?.environment).toBe("development");
    expect(loaded.config.profiles.web?.environment).toBe("local");
  });

  it("returns schema diagnostics for invalid profiles", () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, ".switchboard.yaml"),
      ["version: 1", "profiles:", "  broken:", "    environment: local"].join(
        "\n"
      )
    );

    const loaded = loadSwitchboardConfig({ cwd: root, env: {}, homeDir: root });

    expect(loaded.diagnostics.some((item) => item.level === "error")).toBe(true);
    expect(loaded.diagnostics[0]?.message).toContain("provider");
  });

  it("detects namespace collisions after normalization", () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  supabase-dev:",
        "    provider: supabase",
        "    namespace: Supabase Dev",
        "  supabase_dev:",
        "    provider: supabase",
        "    namespace: supabase-dev"
      ].join("\n")
    );

    const loaded = loadSwitchboardConfig({ cwd: root, env: {}, homeDir: root });

    expect(loaded.namespaceCollisions).toEqual([
      {
        namespace: "supabase_dev",
        profiles: ["supabase-dev", "supabase_dev"]
      }
    ]);
  });
});

function makeTempProject(): string {
  const root = join(
    process.cwd(),
    "node_modules",
    ".tmp",
    `switchboard-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
}
