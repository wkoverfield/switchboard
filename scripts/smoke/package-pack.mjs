#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

// Derive versions from package.json so a version bump never breaks this smoke.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const versionOf = (dir) =>
  JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8")).version;
const coreVersion = versionOf("packages/core");
const runtimeVersion = versionOf("packages/mcp-runtime");
const cliVersion = versionOf("apps/cli");
const docsMcpVersion = versionOf("packages/docs-mcp");

const packages = [
  {
    filter: "@switchboard-mcp/core",
    expectedName: "@switchboard-mcp/core",
    version: coreVersion,
    expectedTarball: `switchboard-mcp-core-${coreVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/mcp-runtime",
    expectedName: "@switchboard-mcp/mcp-runtime",
    version: runtimeVersion,
    expectedTarball: `switchboard-mcp-mcp-runtime-${runtimeVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/cli",
    expectedName: "@switchboard-mcp/cli",
    version: cliVersion,
    expectedTarball: `switchboard-mcp-cli-${cliVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/docs-mcp",
    expectedName: "@switchboard-mcp/docs-mcp",
    version: docsMcpVersion,
    expectedTarball: `switchboard-mcp-docs-mcp-${docsMcpVersion}.tgz`
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
    assert(packageJson.version === packageSpec.version, "package version");
    assert(packageJson.repository?.url, "repository metadata");
    assert(packageJson.license === "MIT", "license metadata");
    assert(
      packageJson.publishConfig?.access === "public",
      "scoped package publish access"
    );
    if (packageSpec.expectedName === "@switchboard-mcp/cli") {
      assert(packageJson.bin?.switchboard === "./dist/index.js", "cli bin");
      assert(
        packageJson.dependencies?.["@switchboard-mcp/core"] === coreVersion,
        "cli core dependency is publishable"
      );
      assert(
        packageJson.dependencies?.["@switchboard-mcp/mcp-runtime"] ===
          runtimeVersion,
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
