import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { switchboardConfigSchema } from "../schemas/config.js";
import {
  createInitConfigPlan,
  renderStarterConfig,
  validateInitConfigOptions
} from "./init-config.js";

describe("init config", () => {
  it("renders a schema-valid generic stdio starter config", () => {
    const content = renderStarterConfig({
      profileName: "local_tools",
      command: "node"
    });
    const parsed = switchboardConfigSchema.parse(parseYaml(content));

    expect(parsed.profiles.local_tools).toMatchObject({
      provider: "generic",
      namespace: "local_tools",
      readOnly: true,
      upstream: {
        type: "stdio",
        command: "node",
        args: ["./path/to/your-mcp-server.mjs"]
      }
    });
    expect(parsed.workspaces.default?.profiles).toEqual(["local_tools"]);
  });

  it("plans .switchboard.yaml from cwd and reports existing files", () => {
    const root = makeTempDir();
    const path = join(root, ".switchboard.yaml");
    writeFileSync(path, "version: 1\n");

    expect(createInitConfigPlan({ cwd: root })).toMatchObject({
      path,
      exists: true
    });
  });

  it("rejects starter config options that would render invalid config", () => {
    expect(
      validateInitConfigOptions({ profileName: "!!!", command: "node" })
    ).toMatchObject({
      ok: false
    });
    expect(
      validateInitConfigOptions({ profileName: "local_tools", command: "" })
    ).toMatchObject({
      ok: false
    });
    expect(
      validateInitConfigOptions({
        profileName: "local_tools",
        command: "node\nboom"
      })
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "command must not contain control characters"
      ])
    });
    expect(() =>
      renderStarterConfig({ profileName: "!!!", command: "node" })
    ).toThrow();
  });
});

function makeTempDir(): string {
  const root = join(
    tmpdir(),
    `switchboard-init-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
}
