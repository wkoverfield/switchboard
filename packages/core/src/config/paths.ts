import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

export interface PathResolutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export interface RepoConfigPaths {
  repoConfigPath?: string;
  repoLocalConfigPath?: string;
}

export function resolveGlobalConfigPath(
  options: PathResolutionOptions = {}
): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const configRoot = env.XDG_CONFIG_HOME
    ? resolve(env.XDG_CONFIG_HOME)
    : join(home, ".config");

  return join(configRoot, "switchboard", "config.yaml");
}

export function findNearestFile(
  fileName: string,
  options: PathResolutionOptions = {}
): string | undefined {
  let current = resolve(options.cwd ?? process.cwd());
  const root = parse(current).root;

  while (true) {
    const candidate = join(current, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }

    if (current === root) {
      return undefined;
    }

    current = dirname(current);
  }
}

export function resolveRepoConfigPaths(
  options: PathResolutionOptions = {}
): RepoConfigPaths {
  const repoConfigPath = findNearestFile(".switchboard.yaml", options);
  const repoLocalConfigPath = findNearestFile(
    ".switchboard.local.yaml",
    options
  );
  const paths: RepoConfigPaths = {};

  if (repoConfigPath) {
    paths.repoConfigPath = repoConfigPath;
  }

  if (repoLocalConfigPath) {
    paths.repoLocalConfigPath = repoLocalConfigPath;
  }

  return paths;
}
