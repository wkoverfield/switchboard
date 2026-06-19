import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDaemonState,
  getDaemonStatus,
  removeDaemonState,
  resolveDaemonPaths,
  writeDaemonState
} from "./daemon-state.js";

describe("daemon state", () => {
  it("resolves runtime paths from explicit runtime dir", () => {
    expect(resolveDaemonPaths({ runtimeDir: "/tmp/switchboard-test" })).toEqual({
      runtimeDir: "/tmp/switchboard-test",
      socketPath: "/tmp/switchboard-test/daemon.sock",
      statePath: "/tmp/switchboard-test/daemon.json"
    });
  });

  it("resolves runtime paths from XDG_RUNTIME_DIR", () => {
    expect(
      resolveDaemonPaths({
        env: { XDG_RUNTIME_DIR: "/run/user/501" } as NodeJS.ProcessEnv
      })
    ).toEqual({
      runtimeDir: "/run/user/501/switchboard",
      socketPath: "/run/user/501/switchboard/daemon.sock",
      statePath: "/run/user/501/switchboard/daemon.json"
    });
  });

  it("reports not-running without a state file", async () => {
    const paths = resolveDaemonPaths({ runtimeDir: await makeTempDir() });

    expect(getDaemonStatus(paths)).toMatchObject({ state: "not-running" });
  });

  it("writes daemon state with private file permissions", async () => {
    const paths = resolveDaemonPaths({ runtimeDir: await makeTempDir() });
    await writeDaemonState(
      createDaemonState({
        pid: process.pid,
        socketPath: paths.socketPath,
        startedAt: new Date("2026-06-19T15:00:00.000Z"),
        cwd: "/tmp/switchboard-project"
      }),
      paths
    );
    await writeFile(paths.socketPath, "");

    expect(getDaemonStatus(paths)).toMatchObject({
      state: "running",
      daemon: {
        pid: process.pid,
        startedAt: "2026-06-19T15:00:00.000Z",
        socketPath: paths.socketPath,
        cwd: "/tmp/switchboard-project"
      }
    });
    expect((await stat(paths.statePath)).mode & 0o777).toBe(0o600);
  });

  it("reports stale when state exists but the process is gone", async () => {
    const paths = resolveDaemonPaths({ runtimeDir: await makeTempDir() });
    await writeDaemonState(
      createDaemonState({
        pid: 99999999,
        socketPath: paths.socketPath
      }),
      paths
    );

    expect(getDaemonStatus(paths)).toMatchObject({ state: "stale" });
  });

  it("reports invalid state and can clean up runtime files", async () => {
    const paths = resolveDaemonPaths({ runtimeDir: await makeTempDir() });
    await writeFile(paths.statePath, "{ nope");
    await writeFile(paths.socketPath, "");

    expect(getDaemonStatus(paths)).toMatchObject({ state: "invalid" });
    await removeDaemonState(paths);
    expect(getDaemonStatus(paths)).toMatchObject({ state: "not-running" });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "reports invalid state for unsafe pid %s",
    async (pid) => {
      const paths = resolveDaemonPaths({ runtimeDir: await makeTempDir() });
      await writeFile(
        paths.statePath,
        JSON.stringify({
          version: 1,
          pid,
          startedAt: "2026-06-19T15:00:00.000Z",
          socketPath: paths.socketPath
        })
      );

      expect(getDaemonStatus(paths)).toMatchObject({
        state: "invalid",
        error: "Daemon state file has an invalid pid."
      });
    }
  );
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "switchboard-daemon-"));
}
