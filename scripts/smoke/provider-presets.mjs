#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:provider-presets`."
  );
}

const list = run(["presets", "list", "--json"]);
assert(list.schemaVersion === "switchboard.provider-preset.v1", "list schema");
assert(
  list.templates?.some?.((template) => template.id === "github-ci"),
  "github-ci listed"
);
assert(
  list.templates?.some?.((template) => template.id === "vercel-preview"),
  "vercel-preview listed"
);

const github = run([
  "presets",
  "show",
  "github-ci",
  "--profile-name",
  "github_findu",
  "--namespace",
  "GitHub FindU",
  "--secret-ref",
  "github/findu/dev/token",
  "--command",
  "npx",
  "--arg",
  "-y",
  "--arg",
  "@modelcontextprotocol/server-github",
  "--json"
]);
assert(github.namespace === "github_findu", "normalized namespace");
assert(github.configYaml.includes("secretRef: github/findu/dev/token"), "secretRef");
assert(github.configYaml.includes("command: npx"), "command");
assert(github.configYaml.includes("- -y"), "arg");
assert(github.mandateCommand.includes("--allow-tool 'github_findu_*'"), "allow");
assert(
  github.mandateCommand.includes("--deny-tool github_findu_deploy_prod"),
  "deny prod"
);
assertNoRawSecret(JSON.stringify(github), "github preset");

const vercel = run(["presets", "show", "vercel-preview", "--json"]);
assert(
  vercel.mandateCommand.includes("--deny-tool vercel_preview_deploy_prod"),
  "vercel prod denied"
);
assertNoRawSecret(JSON.stringify(vercel), "vercel preset");

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function assertNoRawSecret(value, label) {
  assert(!value.includes("ghp_"), `${label} contains GitHub token-like text`);
  assert(
    !value.includes("vercel-token-value"),
    `${label} contains Vercel token-like text`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
