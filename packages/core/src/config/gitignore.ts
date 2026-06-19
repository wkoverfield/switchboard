import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export interface LocalConfigIgnoreCheck {
  ok: boolean;
  method: "git-check-ignore" | "gitignore-file" | "not-found";
  message: string;
}

export function checkLocalConfigIgnored(cwd = process.cwd()): LocalConfigIgnoreCheck {
  const resolvedCwd = resolve(cwd);

  try {
    execFileSync("git", ["check-ignore", ".switchboard.local.yaml"], {
      cwd: resolvedCwd,
      stdio: "ignore"
    });

    return {
      ok: true,
      method: "git-check-ignore",
      message: ".switchboard.local.yaml is ignored by git."
    };
  } catch {
    // Fall through to a text check for fresh folders or environments without git metadata.
  }

  const gitignorePath = findNearestGitignore(resolvedCwd);
  if (!gitignorePath) {
    return {
      ok: false,
      method: "not-found",
      message: "No .gitignore found. Add .switchboard.local.yaml before storing local overrides."
    };
  }

  const lines = readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const ok = lines.includes(".switchboard.local.yaml") ||
    lines.includes("/.switchboard.local.yaml");

  return {
    ok,
    method: "gitignore-file",
    message: ok
      ? ".switchboard.local.yaml is listed in .gitignore."
      : "Add .switchboard.local.yaml to .gitignore before storing local overrides."
  };
}

function findNearestGitignore(cwd: string): string | undefined {
  let current = cwd;
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, ".gitignore");
    if (existsSync(candidate)) {
      return candidate;
    }

    if (current === root) {
      return undefined;
    }

    current = dirname(current);
  }
}
