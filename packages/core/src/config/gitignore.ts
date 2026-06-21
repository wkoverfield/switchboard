import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export interface LocalConfigIgnoreCheck {
  ok: boolean;
  method: "git-check-ignore" | "gitignore-file" | "not-found";
  message: string;
  localConfigPresent: boolean;
  localConfigPath?: string;
}

export function checkLocalConfigIgnored(cwd = process.cwd()): LocalConfigIgnoreCheck {
  const resolvedCwd = resolve(cwd);
  const localConfigPath = findNearestLocalConfig(resolvedCwd);
  const localConfigPresent = localConfigPath !== undefined;
  const ignoreProbePath = localConfigPath ?? join(resolvedCwd, ".switchboard.local.yaml");

  try {
    execFileSync("git", ["check-ignore", ignoreProbePath], {
      cwd: resolvedCwd,
      stdio: "ignore"
    });

    return {
      ok: true,
      method: "git-check-ignore",
      message: ".switchboard.local.yaml is ignored by git.",
      localConfigPresent,
      ...(localConfigPath ? { localConfigPath } : {})
    };
  } catch {
    // Fall through to a text check for fresh folders or environments without git metadata.
  }

  const gitignorePath = findNearestGitignore(
    localConfigPath ? dirname(localConfigPath) : resolvedCwd
  );
  if (!gitignorePath) {
    if (!localConfigPresent) {
      return {
        ok: true,
        method: "not-found",
        message:
          "No .switchboard.local.yaml found. Add it to .gitignore before storing local overrides.",
        localConfigPresent
      };
    }

    return {
      ok: false,
      method: "not-found",
      message:
        "No .gitignore found. Add .switchboard.local.yaml before storing local overrides.",
      localConfigPresent,
      ...(localConfigPath ? { localConfigPath } : {})
    };
  }

  const lines = readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const ignored = lines.includes(".switchboard.local.yaml") ||
    lines.includes("/.switchboard.local.yaml");
  const ok = ignored || !localConfigPresent;

  return {
    ok,
    method: "gitignore-file",
    message: ok
      ? ignored
        ? ".switchboard.local.yaml is listed in .gitignore."
        : "No .switchboard.local.yaml found. Add it to .gitignore before storing local overrides."
      : "Add .switchboard.local.yaml to .gitignore before storing local overrides.",
    localConfigPresent,
    ...(localConfigPath ? { localConfigPath } : {})
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

function findNearestLocalConfig(cwd: string): string | undefined {
  let current = cwd;
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, ".switchboard.local.yaml");
    if (existsSync(candidate)) {
      return candidate;
    }

    if (current === root) {
      return undefined;
    }

    current = dirname(current);
  }
}
