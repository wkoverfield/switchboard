import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const client = process.argv[2];

if (client !== "codex" && client !== "claude") {
  process.stderr.write("Usage: node scripts/smoke/install-write.mjs <codex|claude>\n");
  process.exit(1);
}

const repo = resolve(import.meta.dirname, "..", "..");
const project = mkdtempSync(join(tmpdir(), "switchboard-install-write-"));

try {
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(project, ".switchboard.yaml"),
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

  const first = runCli(project, client, "--write", "--json");
  const targetPath =
    client === "codex"
      ? join(project, ".codex", "config.toml")
      : join(project, ".mcp.json");

  assert(first.action === "created", "expected first write to create config");
  assert(first.targetPath === targetPath, "expected project-scoped target path");
  assert(first.backupPath === null, "expected no backup for first write");
  assert(existsSync(targetPath), "expected config file to be written");
  assert(
    readFileSync(targetPath, "utf8").includes('"mcp"'),
    "expected written config to route through mcp"
  );

  const second = runCli(project, client, "--write", "--json");
  assert(second.action === "updated", "expected second write to update config");
  assert(
    typeof second.backupPath === "string" && existsSync(second.backupPath),
    "expected second write to create backup"
  );

  writeFileSync(targetPath, "mutated\n");
  const rollback = runCli(
    project,
    client,
    "--rollback",
    second.backupPath,
    "--json"
  );
  assert(
    rollback.restoredFrom === second.backupPath,
    "expected rollback to restore requested backup"
  );
  assert(
    readFileSync(targetPath, "utf8").includes('"mcp"'),
    "expected rollback to restore Switchboard config"
  );
} finally {
  rmSync(project, { force: true, recursive: true });
}

function runCli(project, client, ...args) {
  const result = spawnSync(
    process.execPath,
    [join(repo, "apps/cli/dist/index.js"), "--cwd", project, "install", client, ...args],
    {
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
