import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearCallRepoCache,
  deriveRepoDirFromPath,
  pathFromCallArgs,
  resolveCallRepo
} from "./call-repo.js";

async function makeRepo(options: {
  switchboard?: boolean;
  git?: boolean;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-call-repo-"));
  if (options.switchboard) {
    await writeFile(join(root, ".switchboard.yaml"), "version: 1\n");
  }
  if (options.git) {
    await mkdir(join(root, ".git"), { recursive: true });
  }
  return root;
}

describe("pathFromCallArgs allowlist", () => {
  it("reads a filesystem path only from allowlisted keys", () => {
    expect(pathFromCallArgs({ path: "/abs/file.ts" })).toBe("/abs/file.ts");
    expect(pathFromCallArgs({ cwd: "/abs/dir" })).toBe("/abs/dir");
    expect(pathFromCallArgs({ repoPath: "/abs/repo" })).toBe("/abs/repo");
    // Non-allowlisted keys are ignored even when the value is a real path.
    expect(pathFromCallArgs({ query: "/etc/passwd" })).toBeUndefined();
    expect(pathFromCallArgs({ url: "/v1/resource" })).toBeUndefined();
  });

  it("does not treat a bare token or slug as a path", () => {
    // A GitHub-style owner/repo slug or a branch name under a `repo` key must
    // never be mistaken for a checkout on disk.
    expect(pathFromCallArgs({ repo: "switchboard" })).toBeUndefined();
    expect(pathFromCallArgs({ repo: "owner/name" })).toBeUndefined();
    expect(pathFromCallArgs({ repository: "octocat/hello" })).toBeUndefined();
    expect(pathFromCallArgs({ file: "README.md" })).toBeUndefined();
    expect(pathFromCallArgs({ path: "main" })).toBeUndefined();
  });

  it("accepts absolute, home-relative, and explicitly-relative paths", () => {
    expect(pathFromCallArgs({ path: "/abs" })).toBe("/abs");
    expect(pathFromCallArgs({ path: "~/proj" })).toBe("~/proj");
    expect(pathFromCallArgs({ path: "./rel" })).toBe("./rel");
    expect(pathFromCallArgs({ path: "../sibling" })).toBe("../sibling");
  });

  it("reads the first path-shaped entry from an array value", () => {
    expect(pathFromCallArgs({ paths: ["bare", "/abs/x"] })).toBe("/abs/x");
    expect(pathFromCallArgs({ files: ["a", "b"] })).toBeUndefined();
  });
});

describe("deriveRepoDirFromPath", () => {
  beforeEach(() => {
    clearCallRepoCache();
  });
  afterEach(() => {
    clearCallRepoCache();
  });

  it("resolves the nearest ancestor .switchboard.yaml", async () => {
    const repo = await makeRepo({ switchboard: true });
    const nested = join(repo, "src", "deep", "file.ts");
    expect(deriveRepoDirFromPath(nested)).toBe(repo);
  });

  it("falls back to the nearest git root when no config is present", async () => {
    const repo = await makeRepo({ git: true });
    const nested = join(repo, "packages", "app");
    await mkdir(nested, { recursive: true });
    expect(deriveRepoDirFromPath(join(nested, "index.ts"))).toBe(repo);
  });

  it("prefers .switchboard.yaml over the git root", async () => {
    const repo = await makeRepo({ switchboard: true, git: true });
    expect(deriveRepoDirFromPath(join(repo, "x.ts"))).toBe(repo);
  });

  it("returns undefined for a path in no repo", async () => {
    const loose = await mkdtemp(join(tmpdir(), "switchboard-call-repo-loose-"));
    expect(deriveRepoDirFromPath(join(loose, "file.ts"))).toBeUndefined();
  });

  it("memoizes a resolution against an injected clock", async () => {
    const repo = await makeRepo({ switchboard: true });
    const file = join(repo, "a.ts");
    let nowMs = 1_000;
    expect(deriveRepoDirFromPath(file, () => nowMs)).toBe(repo);
    // Within the window the cached result stands even if the marker vanishes.
    await writeFile(join(repo, ".switchboard.yaml"), "");
    nowMs += 100;
    expect(deriveRepoDirFromPath(file, () => nowMs)).toBe(repo);
  });
});

describe("resolveCallRepo precedence", () => {
  beforeEach(() => {
    clearCallRepoCache();
  });
  afterEach(() => {
    clearCallRepoCache();
  });

  it("binds the repo named by the call's path (call-path wins over session cwd)", async () => {
    const repoA = await makeRepo({ switchboard: true });
    const repoB = await makeRepo({ switchboard: true });

    const resolution = resolveCallRepo({
      args: { path: join(repoB, "src", "x.ts") },
      sessionCwd: repoA
    });
    expect(resolution).toEqual({
      effectiveCwd: repoB,
      resolvedRepoPath: repoB,
      source: "call-path"
    });
  });

  it("honors the session cwd when the call carries no path", async () => {
    const repoC = await makeRepo({ switchboard: true });
    const resolution = resolveCallRepo({ args: {}, sessionCwd: repoC });
    expect(resolution).toEqual({
      effectiveCwd: repoC,
      resolvedRepoPath: repoC,
      source: "session-cwd"
    });
  });

  it("falls back to the global default when nothing derives a repo", async () => {
    const home = await mkdtemp(join(tmpdir(), "switchboard-call-repo-home-"));
    const resolution = resolveCallRepo({ args: {}, sessionCwd: home });
    expect(resolution).toEqual({
      effectiveCwd: home,
      resolvedRepoPath: undefined,
      source: "global-default"
    });
  });

  it("falls through to the session cwd when a path arg resolves to no repo", async () => {
    const repoC = await makeRepo({ switchboard: true });
    const outOfTree = await mkdtemp(join(tmpdir(), "switchboard-call-repo-out-"));
    const resolution = resolveCallRepo({
      args: { path: join(outOfTree, "loose.ts") },
      sessionCwd: repoC
    });
    expect(resolution).toEqual({
      effectiveCwd: repoC,
      resolvedRepoPath: repoC,
      source: "session-cwd"
    });
  });

  it("expands a ~-relative path against the injected home dir", async () => {
    const home = await makeRepo({ switchboard: true });
    const resolution = resolveCallRepo({
      args: { path: "~/pkg/file.ts" },
      sessionCwd: undefined,
      homeDir: home
    });
    expect(resolution.source).toBe("call-path");
    expect(resolution.resolvedRepoPath).toBe(home);
  });
});
