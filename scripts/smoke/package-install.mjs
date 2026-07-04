#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const packages = [
  {
    filter: "@switchboard-mcp/core",
    tarball: `switchboard-mcp-core-${coreVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/mcp-runtime",
    tarball: `switchboard-mcp-mcp-runtime-${runtimeVersion}.tgz`
  },
  {
    filter: "@switchboard-mcp/cli",
    tarball: `switchboard-mcp-cli-${cliVersion}.tgz`
  }
];

const tempRoot = tmpdir();
const packDir = mkdtempSync(join(tempRoot, "switchboard-package-install-pack-"));
const projectDir = mkdtempSync(join(tempRoot, "switchboard-package-install-project-"));

try {
  for (const packageSpec of packages) {
    run("pnpm", [
      "--filter",
      packageSpec.filter,
      "pack",
      "--pack-destination",
      packDir
    ]);
  }

  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@switchboard-mcp/core": `file:${join(
            packDir,
            `switchboard-mcp-core-${coreVersion}.tgz`
          )}`,
          "@switchboard-mcp/mcp-runtime": `file:${join(
            packDir,
            `switchboard-mcp-mcp-runtime-${runtimeVersion}.tgz`
          )}`,
          "@switchboard-mcp/cli": `file:${join(
            packDir,
            `switchboard-mcp-cli-${cliVersion}.tgz`
          )}`
        }
      },
      null,
      2
    )
  );
  writeFileSync(
    join(projectDir, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  smoke:",
      "    provider: generic",
      "    upstream:",
      "      type: stdio",
      "      command: node",
      "      args:",
      "        - ./server.mjs"
    ].join("\n")
  );

  run("npm", ["install", "--prefix", projectDir]);

  const help = run(join(projectDir, "node_modules", ".bin", "switchboard"), [
    "--help"
  ], projectDir);
  assert(help.includes("Usage: switchboard"), "expected installed switchboard help");

  const doctor = JSON.parse(
    run(join(projectDir, "node_modules", ".bin", "switchboard"), [
      "doctor",
      "--json"
    ], projectDir)
  );
  assert(doctor.status === "setup-incomplete", "expected doctor to run");
  assert(
    doctor.nextSteps.includes("switchboard test smoke"),
    "expected installed binary next steps"
  );
} finally {
  rmSync(packDir, { force: true, recursive: true });
  rmSync(projectDir, { force: true, recursive: true });
}

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
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
