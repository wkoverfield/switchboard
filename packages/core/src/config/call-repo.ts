import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findNearestFile, findNearestGitRoot } from "./paths.js";

/**
 * Lazy per-call repo resolution.
 *
 * A single daemon serves calls from a session that may have been launched at
 * `~` and then wander across repos. Scope must resolve from what a call is
 * about to touch, not from where the session started. This module derives the
 * governing repo of one routed call from its arguments, with a strict
 * precedence:
 *
 *   explicit call path  >  session cwd  >  global default
 *
 * A call with no derivable path resolves to the machine-level global config
 * (the "global default"): the seatbelt floor still applies, repo profiles are
 * simply not bound. It never prompts and never denies for lack of context.
 */

export type CallRepoResolutionSource =
  | "call-path"
  | "session-cwd"
  | "global-default";

export interface ResolveCallRepoOptions {
  /** The routed call's arguments (a `call_tool` request's `arguments`). */
  args?: Record<string, unknown> | undefined;
  /** The session/launch cwd carried by the connection, if any. */
  sessionCwd?: string | undefined;
  homeDir?: string;
  now?: () => number;
}

export interface CallRepoResolution {
  /**
   * The cwd downstream config loading should resolve against. For a call-path
   * resolution this is the derived repo dir; otherwise the session cwd (which
   * may be undefined). Config layering walks up from here.
   */
  effectiveCwd: string | undefined;
  /**
   * The governing repo dir a call resolved against, or undefined for the
   * global default. Recorded in the audit log so "why this policy" for a call
   * is inspectable.
   */
  resolvedRepoPath: string | undefined;
  source: CallRepoResolutionSource;
}

/**
 * Argument keys whose value may name a filesystem path the call governs.
 *
 * Deliberately narrow: only keys that unambiguously mean "a file, directory,
 * repo, or working directory". An arbitrary string arg is never treated as a
 * path, so a value that merely looks path-like (a git ref, a URL, an
 * `owner/repo` slug under some other key) cannot mis-resolve a call. This is
 * paired with a value-shape guard (see `pathLikeValue`) so even an allowlisted
 * key only counts when its value is an absolute or explicitly-relative path.
 */
export const callPathArgKeys: ReadonlySet<string> = new Set([
  "path",
  "paths",
  "file",
  "files",
  "filename",
  "filepath",
  "dir",
  "dirs",
  "directory",
  "folder",
  "cwd",
  "workingdirectory",
  "repo",
  "repopath",
  "repository",
  "repositorypath",
  "root",
  "rootpath",
  "projectroot",
  "worktree",
  "worktreepath"
]);

/**
 * Return the first allowlisted, path-shaped argument value (raw, unresolved),
 * or undefined when the call carries no filesystem path. Arrays are supported
 * (the first path-shaped element wins) so tools that take `paths`/`files`
 * still resolve.
 */
export function pathFromCallArgs(
  args: Record<string, unknown> | undefined
): string | undefined {
  if (!args) {
    return undefined;
  }

  for (const [key, value] of Object.entries(args)) {
    if (!callPathArgKeys.has(key.toLowerCase())) {
      continue;
    }

    if (typeof value === "string") {
      if (pathLikeValue(value)) {
        return value;
      }
      continue;
    }

    if (Array.isArray(value)) {
      const first = value.find(
        (item): item is string =>
          typeof item === "string" && pathLikeValue(item)
      );
      if (first !== undefined) {
        return first;
      }
    }
  }

  return undefined;
}

/**
 * Whether a string looks like a filesystem path we are willing to resolve.
 * Only absolute paths (POSIX, Windows, or `~`-relative) and explicitly
 * relative paths (`./`, `../`) qualify. A bare token (`"main"`,
 * `"owner/repo"`, `"README.md"`) does NOT, which is what keeps a GitHub-style
 * `repo` slug or a branch name from being mistaken for a checkout on disk.
 */
function pathLikeValue(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (value.startsWith("~")) {
    return true;
  }
  if (isAbsolute(value)) {
    return true;
  }
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  );
}

function toAbsolutePath(
  value: string,
  sessionCwd: string | undefined,
  homeDir: string
): string {
  let expanded = value;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = join(homeDir, expanded.slice(2));
  }

  if (isAbsolute(expanded)) {
    return resolve(expanded);
  }

  return resolve(sessionCwd ?? process.cwd(), expanded);
}

// Directory to begin the upward walk from. A directory path walks from itself;
// a file path (or a not-yet-created file) walks from its parent, so a call
// naming a file resolves the repo the file lives in rather than treating the
// file as a directory.
function startDirForPath(absPath: string): string {
  try {
    if (statSync(absPath).isDirectory()) {
      return absPath;
    }
  } catch {
    // Nonexistent path (e.g. a file about to be written): fall back to parent.
  }
  return dirname(absPath);
}

// Bounded, short-lived memoization of the fs walk. A wave of calls to the same
// repo within the window resolves without re-walking the tree every call. The
// TTL keeps a freshly-added or removed `.switchboard.yaml` from being cached
// indefinitely; the size cap bounds memory under a spray of distinct paths.
interface RepoDirCacheEntry {
  repoDir: string | undefined;
  expiresAt: number;
}

const repoDirCache = new Map<string, RepoDirCacheEntry>();
const repoDirCacheTtlMs = 5_000;
const repoDirCacheMaxEntries = 512;

/** Test hook: drop all memoized repo-dir resolutions. */
export function clearCallRepoCache(): void {
  repoDirCache.clear();
}

/**
 * Derive the governing repo dir for an absolute path: the nearest ancestor
 * containing `.switchboard.yaml`, else the nearest git root, else undefined.
 * Memoized by start directory within a short window.
 */
export function deriveRepoDirFromPath(
  absPath: string,
  now: () => number = Date.now
): string | undefined {
  const startDir = startDirForPath(absPath);
  const nowMs = now();

  const cached = repoDirCache.get(startDir);
  if (cached && cached.expiresAt > nowMs) {
    return cached.repoDir;
  }

  const configPath = findNearestFile(".switchboard.yaml", { cwd: startDir });
  const repoDir = configPath
    ? dirname(configPath)
    : findNearestGitRoot({ cwd: startDir });

  if (repoDirCache.size >= repoDirCacheMaxEntries) {
    const oldest = repoDirCache.keys().next().value;
    if (oldest !== undefined) {
      repoDirCache.delete(oldest);
    }
  }
  repoDirCache.set(startDir, {
    repoDir,
    expiresAt: nowMs + repoDirCacheTtlMs
  });

  return repoDir;
}

/**
 * Resolve which repo a routed call governs. See the module doc for the
 * precedence. Pure and side-effect free apart from the bounded resolution
 * cache.
 */
export function resolveCallRepo(
  options: ResolveCallRepoOptions = {}
): CallRepoResolution {
  const homeDir = options.homeDir ?? homedir();
  const now = options.now ?? Date.now;
  const sessionCwd = options.sessionCwd;

  // 1. Explicit call path wins. A path arg that resolves to no repo (walked to
  // the filesystem root with neither `.switchboard.yaml` nor `.git`) falls
  // through rather than guessing, so an out-of-tree path never mis-binds.
  const rawPath = pathFromCallArgs(options.args);
  if (rawPath !== undefined) {
    const absPath = toAbsolutePath(rawPath, sessionCwd, homeDir);
    const repoDir = deriveRepoDirFromPath(absPath, now);
    if (repoDir !== undefined) {
      return {
        effectiveCwd: repoDir,
        resolvedRepoPath: repoDir,
        source: "call-path"
      };
    }
  }

  // 2. Session cwd, when the session was launched inside a repo.
  if (sessionCwd !== undefined) {
    const repoDir = deriveRepoDirFromPath(resolve(sessionCwd), now);
    if (repoDir !== undefined) {
      return {
        effectiveCwd: sessionCwd,
        resolvedRepoPath: repoDir,
        source: "session-cwd"
      };
    }
  }

  // 3. Global default: no derivable repo. Seatbelt floor still applies; repo
  // profiles are simply not bound.
  return {
    effectiveCwd: sessionCwd,
    resolvedRepoPath: undefined,
    source: "global-default"
  };
}
