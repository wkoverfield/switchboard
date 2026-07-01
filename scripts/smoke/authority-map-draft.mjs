#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const fixtureServerPath = join(
  repo,
  "packages/mcp-runtime/fixtures/echo-server.mjs"
);
const project = mkdtempSync(join(tmpdir(), "switchboard-authority-map-"));
const configPath = join(project, ".switchboard.yaml");
const mapPath = join(project, "authority-map.json");

try {
  run("git", ["init", "-b", "main"], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    configPath,
    [
      "version: 1",
      "profiles:",
      "  generic_tools:",
      "    provider: generic",
      "    namespace: generic_tools",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - generic-tools",
      "        - ''",
      "        - ''",
      "        - list_records",
      "        - create_record",
      "        - deploy_prod",
      "        - sync"
    ].join("\n")
  );
  const before = readFileSync(configPath, "utf8");

  const draft = runCliJson([
    "authority",
    "draft",
    "--profile",
    "generic_tools",
    "--json"
  ]);
  assert(draft.schemaVersion === "switchboard.authority-map-draft.v1", "schema");
  assert(draft.profileName === "generic_tools", "profile name");
  assert(draft.namespace === "generic_tools", "namespace");
  assert(draft.counts.allowed === 3, "echo/whoami/list allowed");
  assert(draft.counts.approvalRequired === 1, "create approval");
  assert(draft.counts.denied === 1, "prod denied");
  assert(draft.counts.review === 1, "sync review");
  assert(
    draft.suggestedMandatePolicy.allowedTools.includes(
      "generic_tools_list_records"
    ),
    "allowed policy"
  );
  assert(
    draft.suggestedMandatePolicy.deniedTools.includes(
      "generic_tools_deploy_prod"
    ),
    "denied policy"
  );
  assert(
    draft.suggestedMandatePolicy.deniedTools.includes("generic_tools_sync"),
    "review denied by suggested policy"
  );
  assert(
    draft.suggestedMandatePolicy.approvalGates.some(
      (gate) => gate.toolPattern === "generic_tools_create_record"
    ),
    "approval policy"
  );
  writeFileSync(mapPath, `${JSON.stringify(draft, null, 2)}\n`);

  const check = runCliJson(["authority", "check", mapPath, "--json"]);
  assert(check.schemaVersion === "switchboard.authority-map-check.v1", "check schema");
  assert(check.ok === true, "check ok");
  assert(check.needsHumanReview === true, "review warning preserved");

  const mandate = runCliJson([
    "mandate",
    "create",
    "inspect-generic-tools",
    "--from-authority",
    mapPath,
    "--accept-review",
    "--agent",
    "reviewer",
    "--lease",
    "1h",
    "--json"
  ]);
  assert(mandate.authorityMap?.profileName === "generic_tools", "authority metadata");
  assert(mandate.authorityMap?.acceptedReview === true, "review acknowledged");
  assert(
    mandate.mandate?.allowedTools?.includes("generic_tools_list_records"),
    "map allowed policy applied"
  );
  assert(
    mandate.mandate?.deniedTools?.includes("generic_tools_sync"),
    "review tool denied in mandate"
  );
  assert(
    mandate.mandate?.approvalGates?.some(
      (gate) => gate.toolPattern === "generic_tools_create_record"
    ),
    "map approval policy applied"
  );
  assert(
    mandate.workspaceLease?.authority?.profiles?.includes("generic_tools"),
    "workspace lease authority"
  );

  const human = runCli([
    "authority",
    "draft",
    "--profile",
    "generic_tools"
  ]);
  assert(human.stdout.includes("Switchboard authority map draft"), "human title");
  assert(human.stdout.includes("Discovered 6 tools"), "human discovered count");
  assert(human.stdout.includes("Allowed 3, approval-required 1, denied 1, review 1"), "human counts");

  const after = readFileSync(configPath, "utf8");
  assert(after === before, "authority draft must not mutate config");
} finally {
  rmSync(project, { force: true, recursive: true });
}

function runCliJson(args) {
  const result = runCli(args);
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function runCli(args) {
  return run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(project, "xdg-config"),
      XDG_DATA_HOME: join(project, "xdg-data"),
      XDG_STATE_HOME: join(project, "xdg-state"),
      TS_KEYRING_BACKEND: "file",
      SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS: "1"
    },
    timeout: 120_000
  });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
