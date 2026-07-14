#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

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
    name: "@switchboard-mcp/core",
    tarball: `switchboard-mcp-core-${coreVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/mcp-runtime",
    name: "@switchboard-mcp/mcp-runtime",
    tarball: `switchboard-mcp-mcp-runtime-${runtimeVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/cli",
    name: "@switchboard-mcp/cli",
    tarball: `switchboard-mcp-cli-${cliVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/docs-mcp",
    name: "@switchboard-mcp/docs-mcp",
    tarball: `switchboard-mcp-docs-mcp-${docsMcpVersion}.tgz`
  }
];

const packDir = mkdtempSync(join(tmpdir(), "switchboard-npm-alpha-preflight-"));
const auth = runOptional("npm", ["whoami"]);
const registry = run("npm", ["config", "get", "registry"]).stdout.trim();
const results = [];

try {
  for (const packageSpec of packages) {
    run("pnpm", [
      "--filter",
      packageSpec.filter,
      "pack",
      "--pack-destination",
      packDir
    ]);
    const tarball = join(packDir, packageSpec.tarball);
    const packageJson = JSON.parse(
      run("tar", ["-xOf", tarball, "package/package.json"]).stdout
    );
    const published = runOptional("npm", [
      "view",
      `${packageSpec.name}@${packageJson.version}`,
      "version",
      "--json"
    ]);
    const dryRun = runOptional("npm", [
      "publish",
      tarball,
      "--access",
      "public",
      "--dry-run"
    ]);

    results.push({
      name: packageSpec.name,
      version: packageJson.version,
      tarball,
      publishConfig: packageJson.publishConfig ?? null,
      alreadyPublished: published.status === 0,
      dryRunOk: dryRun.status === 0,
      dryRunError: dryRun.status === 0 ? null : summarizeError(dryRun)
    });
  }

  const payload = {
    schemaVersion: "switchboard.npm-alpha-preflight.v1",
    registry,
    authenticated: auth.status === 0,
    npmUser: auth.status === 0 ? auth.stdout.trim() : null,
    authError: auth.status === 0 ? null : summarizeError(auth),
    packages: results,
    publishOrder: packages.map((packageSpec) => packageSpec.name),
    nextActions:
      auth.status === 0
        ? [
            "Publish the tarballs above in dependency order with npm publish <tarball> --access public.",
            "Verify npm install -g @switchboard-mcp/cli in a clean temp shell."
          ]
        : [
            "Run npm adduser or configure an npm automation token.",
            "Re-run pnpm release:npm-alpha:preflight after authentication."
          ]
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (auth.status !== 0) {
    process.exitCode = 1;
  }
} finally {
  rmSync(packDir, { force: true, recursive: true });
}

function run(command, args) {
  const result = runOptional(command, args);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  return result;
}

function runOptional(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function summarizeError(result) {
  return [result.stderr, result.stdout]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
}
