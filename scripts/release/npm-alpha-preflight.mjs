#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const packages = [
  {
    filter: "@switchboard-mcp/core",
    name: "@switchboard-mcp/core",
    tarball: "switchboard-mcp-core-0.1.0.tgz"
  },
  {
    filter: "@switchboard-mcp/mcp-runtime",
    name: "@switchboard-mcp/mcp-runtime",
    tarball: "switchboard-mcp-mcp-runtime-0.1.0.tgz"
  },
  {
    filter: "@switchboard-mcp/cli",
    name: "@switchboard-mcp/cli",
    tarball: "switchboard-mcp-cli-0.1.0.tgz"
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
            "Run pnpm release:npm-alpha:publish when ready.",
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
