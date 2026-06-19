#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const fixtureServerPath = resolve(
  repoRoot,
  "packages",
  "mcp-runtime",
  "fixtures",
  "echo-server.mjs"
);
const tmpRoot = join(
  "/tmp",
  `switchboard-daemon-tools-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const runtimeDir = join(tmpRoot, "runtime");

try {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(
    join(tmpRoot, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  daemon_fixture:",
      "    provider: generic",
      "    namespace: daemon_fixture",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - daemon"
    ].join("\n")
  );

  const start = run("start");
  assert(start.ok === true, "daemon start should succeed");

  const tools = run("tools");
  assert(tools.ok === true, "daemon tools should succeed");
  const names = tools.response?.tools?.map((tool) => tool.name) ?? [];
  assert(names.includes("daemon_fixture_echo"), "daemon should list echo tool");
  assert(names.includes("daemon_fixture_whoami"), "daemon should list whoami tool");

  const stop = run("stop");
  assert(stop.ok === true, "daemon stop should succeed");
} finally {
  run("stop", { allowFailure: true });
  rmSync(tmpRoot, { recursive: true, force: true });
}

function run(command, options = {}) {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--cwd",
      tmpRoot,
      "daemon",
      command,
      "--runtime-dir",
      runtimeDir,
      "--json"
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SWITCHBOARD_RUNTIME_DIR: runtimeDir
      }
    }
  );

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `daemon ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
