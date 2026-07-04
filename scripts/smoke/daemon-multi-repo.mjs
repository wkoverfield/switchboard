#!/usr/bin/env node
// Proves the daemon multiplexes: ONE daemon serves TWO repos, and each repo's
// `daemon tools` sees only its own profile. This is the regression guard for
// the multi-repo value proposition (no per-machine singleton collision).
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

// Short runtime dir: unix socket paths are length-limited (~104 chars on macOS).
const tmpRoot = join(
  "/tmp",
  `sb-multi-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const runtimeDir = join(tmpRoot, "rt");
const repoA = join(tmpRoot, "repoA");
const repoB = join(tmpRoot, "repoB");

function writeRepo(dir, namespace) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      `  ${namespace}:`,
      "    provider: generic",
      `    namespace: ${namespace}`,
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      `        - ${namespace}`
    ].join("\n")
  );
}

try {
  writeRepo(repoA, "alpha_fixture");
  writeRepo(repoB, "beta_fixture");

  // One daemon, started bound to repoA.
  const start = daemon(repoA, "start");
  assert(start.ok === true, "daemon start should succeed");

  // repoA's tools, from the shared daemon.
  const aTools = toolNames(daemon(repoA, "tools"));
  assert(
    aTools.includes("alpha_fixture_echo") && !aTools.some((n) => n.startsWith("beta_")),
    `repoA should see only alpha tools, saw: ${aTools.join(", ")}`
  );

  // repoB's tools, from the SAME daemon (never restarted).
  const bTools = toolNames(daemon(repoB, "tools"));
  assert(
    bTools.includes("beta_fixture_echo") && !bTools.some((n) => n.startsWith("alpha_")),
    `repoB should see only beta tools, saw: ${bTools.join(", ")}`
  );

  // repoA again, to prove state isn't sticky per last caller.
  const aAgain = toolNames(daemon(repoA, "tools"));
  assert(
    aAgain.includes("alpha_fixture_echo") && !aAgain.some((n) => n.startsWith("beta_")),
    `repoA (again) should still see only alpha tools, saw: ${aAgain.join(", ")}`
  );

  daemon(repoA, "stop");
  process.stdout.write("daemon-multi-repo: one daemon served two repos in isolation\n");
} finally {
  daemon(repoA, "stop", { allowFailure: true });
  rmSync(tmpRoot, { recursive: true, force: true });
}

function daemon(cwd, command, options = {}) {
  const result = spawnSync(
    process.execPath,
    [cliPath, "--cwd", cwd, "daemon", command, "--runtime-dir", runtimeDir, "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, SWITCHBOARD_RUNTIME_DIR: runtimeDir }
    }
  );
  if (!options.allowFailure && result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {};
  }
}

function toolNames(response) {
  return response.response?.tools?.map((tool) => tool.name) ?? [];
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
