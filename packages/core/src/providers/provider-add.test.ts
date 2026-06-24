import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { switchboardConfigSchema } from "../schemas/config.js";
import {
  createProviderAddPlan,
  writeProviderAddPlan
} from "./provider-add.js";

describe("provider add plans", () => {
  it("plans a value-free GitHub CI setup without writing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "switchboard-add-plan-"));
    const plan = await createProviderAddPlan({
      id: "github-ci",
      cwd,
      profileName: "github_findu",
      namespace: "GitHub FindU",
      secretRef: "github/findu/dev/token"
    });

    expect(plan.exists).toBe(false);
    expect(plan.targetPath).toBe(join(cwd, ".switchboard.yaml"));
    expect(plan.secretCommands).toEqual([
      "switchboard secrets set github/findu/dev/token --value-stdin"
    ]);
    expect(plan.checkCommand).toBe(
      "switchboard presets check github-ci --profile github_findu"
    );
    expect(plan.mandateCommand).toContain("--profiles github_findu");
    expect(plan.nextContent).not.toContain("ghp_");

    const parsed = switchboardConfigSchema.parse(parseYaml(plan.nextContent));
    expect(parsed.profiles.github_findu).toMatchObject({
      provider: "github",
      namespace: "github_findu",
      upstream: {
        type: "stdio",
        command: "docker",
        args: [
          "run",
          "-i",
          "--rm",
          "-e",
          "GITHUB_PERSONAL_ACCESS_TOKEN",
          "ghcr.io/github/github-mcp-server"
        ],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: {
            secretRef: "github/findu/dev/token"
          }
        }
      }
    });
  });

  it("writes and merges a provider setup with an existing repo config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "switchboard-add-write-"));
    const configPath = join(cwd, ".switchboard.yaml");
    await writeFile(
      configPath,
      [
        "version: 1",
        "profiles:",
        "  local_example:",
        "    provider: generic",
        "    namespace: local_example",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "workspaces:",
        "  default:",
        "    paths:",
        "      - .",
        "    profiles:",
        "      - local_example"
      ].join("\n"),
      "utf8"
    );

    const result = await writeProviderAddPlan({
      id: "github-ci",
      cwd,
      profileName: "github_findu",
      secretRef: "github/findu/dev/token",
      now: new Date("2026-06-23T12:00:00.000Z")
    });

    expect(result.action).toBe("updated");
    expect(result.backupPath).toBe(
      `${configPath}.switchboard-backup-20260623-120000000Z`
    );

    const parsed = switchboardConfigSchema.parse(
      parseYaml(await readFile(configPath, "utf8"))
    );
    expect(Object.keys(parsed.profiles)).toEqual([
      "local_example",
      "github_findu"
    ]);
    expect(parsed.workspaces.default?.profiles).toEqual([
      "local_example",
      "github_findu"
    ]);
  });

  it("updates the nearest existing repo config from a nested cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchboard-add-nested-"));
    const nested = join(root, "packages", "app");
    const configPath = join(root, ".switchboard.yaml");
    await writeFile(
      configPath,
      [
        "version: 1",
        "profiles:",
        "  local_example:",
        "    provider: generic",
        "    namespace: local_example",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n"),
      "utf8"
    );

    const plan = await createProviderAddPlan({
      id: "github-ci",
      cwd: nested,
      profileName: "github_findu"
    });

    expect(plan.targetPath).toBe(configPath);
  });
});
