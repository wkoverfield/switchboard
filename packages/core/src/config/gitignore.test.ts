import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkLocalConfigIgnored } from "./gitignore.js";

describe("checkLocalConfigIgnored", () => {
  it("passes when .switchboard.local.yaml is listed in a nearest .gitignore", () => {
    const root = makeTempProject();
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(join(root, ".switchboard.local.yaml"), "version: 1\n");

    expect(checkLocalConfigIgnored(nested)).toMatchObject({
      ok: true,
      method: "gitignore-file",
      localConfigPresent: true,
      localConfigPath: join(root, ".switchboard.local.yaml")
    });
  });

  it("passes when no local config file exists yet", () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");

    expect(checkLocalConfigIgnored(root)).toMatchObject({
      ok: true,
      method: "gitignore-file",
      localConfigPresent: false
    });
  });

  it("passes for ephemeral folders without local config or .gitignore", () => {
    const root = makeTempProject();

    expect(checkLocalConfigIgnored(root)).toMatchObject({
      ok: true,
      method: "not-found",
      localConfigPresent: false
    });
  });

  it("fails when a local config file exists without an ignore rule", () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    writeFileSync(join(root, ".switchboard.local.yaml"), "version: 1\n");

    expect(checkLocalConfigIgnored(root)).toMatchObject({
      ok: false,
      method: "gitignore-file",
      localConfigPresent: true,
      localConfigPath: join(root, ".switchboard.local.yaml")
    });
  });

  it("checks the discovered parent local config from nested cwd", () => {
    const root = makeTempProject();
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    writeFileSync(join(root, ".switchboard.local.yaml"), "version: 1\n");
    writeFileSync(join(nested, ".gitignore"), ".switchboard.local.yaml\n");

    expect(checkLocalConfigIgnored(nested)).toMatchObject({
      ok: false,
      localConfigPresent: true,
      localConfigPath: join(root, ".switchboard.local.yaml")
    });
  });

  it("fails when a local config file exists without any .gitignore", () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".switchboard.local.yaml"), "version: 1\n");

    expect(checkLocalConfigIgnored(root)).toMatchObject({
      ok: false,
      method: "not-found",
      localConfigPresent: true,
      localConfigPath: join(root, ".switchboard.local.yaml")
    });
  });
});

function makeTempProject(): string {
  const root = join(
    tmpdir(),
    `switchboard-gitignore-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
}
