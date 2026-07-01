#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const packages = [
  {
    filter: "@switchboard-mcp/core",
    expectedName: "@switchboard-mcp/core",
    expectedTarball: "switchboard-mcp-core-0.1.2.tgz"
  },
  {
    filter: "@switchboard-mcp/mcp-runtime",
    expectedName: "@switchboard-mcp/mcp-runtime",
    expectedTarball: "switchboard-mcp-mcp-runtime-0.1.2.tgz"
  },
  {
    filter: "@switchboard-mcp/cli",
    expectedName: "@switchboard-mcp/cli",
    expectedTarball: "switchboard-mcp-cli-0.1.2.tgz"
  }
];

const packDir = mkdtempSync(join(tmpdir(), "switchboard-pack-smoke-"));

try {
  for (const packageSpec of packages) {
    const output = run("pnpm", [
      "--filter",
      packageSpec.filter,
      "pack",
      "--pack-destination",
      packDir
    ]);
    assert(
      output.includes(packageSpec.expectedTarball),
      `expected ${packageSpec.expectedTarball} in pack output`
    );

    const tarball = join(packDir, packageSpec.expectedTarball);
    const listing = run("tar", ["-tf", tarball]);
    assert(listing.includes("package/package.json"), "package.json included");
    assert(listing.includes("package/README.md"), "README included");
    assert(listing.includes("package/dist/index.js"), "dist index included");
    assert(!listing.includes(".test.js"), "compiled JS tests excluded");
    assert(!listing.includes(".test.d.ts"), "compiled test types excluded");

    const packageJson = JSON.parse(
      run("tar", ["-xOf", tarball, "package/package.json"])
    );
    assert(packageJson.name === packageSpec.expectedName, "package name");
    assert(packageJson.version === "0.1.2", "package version");
    assert(packageJson.repository?.url, "repository metadata");
    assert(packageJson.license === "MIT", "license metadata");
    assert(
      packageJson.publishConfig?.access === "public",
      "scoped package publish access"
    );
    if (packageSpec.expectedName === "@switchboard-mcp/cli") {
      assert(packageJson.bin?.switchboard === "./dist/index.js", "cli bin");
      assert(
        packageJson.dependencies?.["@switchboard-mcp/core"] === "0.1.2",
        "cli core dependency is publishable"
      );
      assert(
        packageJson.dependencies?.["@switchboard-mcp/mcp-runtime"] === "0.1.2",
        "cli runtime dependency is publishable"
      );
    }
  }
} finally {
  rmSync(packDir, { force: true, recursive: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  return `${result.stdout}${result.stderr}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
