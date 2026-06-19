import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "./program.js";

describe("switchboard CLI program", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("prints status JSON for a repo config resolved with --cwd", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  supabase_findu_dev:",
        "    provider: supabase",
        "    environment: development"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "status", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      profileCount: number;
      namespaces: Array<{ namespace: string }>;
    };
    expect(parsed.profileCount).toBe(1);
    expect(parsed.namespaces[0]?.namespace).toBe("supabase_findu_dev");
  });

  it("returns a failing doctor result for invalid config", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      ["version: 1", "profiles:", "  broken:", "    namespace: '!!!'"].join(
        "\n"
      )
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      diagnostics: Array<{ message: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.message).toContain("provider");
    expect(process.exitCode).toBe(1);
  });

  it("fails doctor when .switchboard.local.yaml is not ignored", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      checks: Array<{ name: string; ok: boolean }>;
    };
    expect(parsed.ok).toBe(false);
    expect(
      parsed.checks.find((check) => check.name === "local-config-gitignore")?.ok
    ).toBe(false);
  });

  it("fails doctor on namespace collisions", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  stripe-live:",
        "    provider: stripe",
        "  stripe_live:",
        "    provider: stripe"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      namespaceCollisions: Array<{ namespace: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.namespaceCollisions[0]?.namespace).toBe("stripe_live");
  });
});

function makeTempProject(): string {
  const root = join(
    tmpdir(),
    `switchboard-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
}
