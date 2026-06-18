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

    expect(checkLocalConfigIgnored(nested)).toMatchObject({
      ok: true,
      method: "gitignore-file"
    });
  });

  it("fails when no ignore rule is present", () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");

    expect(checkLocalConfigIgnored(root)).toMatchObject({
      ok: false,
      method: "gitignore-file"
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
