import { afterEach } from "vitest";
import { getDaemonStatus, resolveDaemonPaths } from "@switchboard-mcp/core";
import { runDaemon } from "./daemon-runtime.js";

/**
 * Test-only daemon lifecycle harness. Every daemon started through it is
 * registered for teardown, and the harness registers its own afterEach hook,
 * so a test that starts a daemon cannot leak it past the test even if the
 * test forgets to stop it or fails mid-way. Tests must start daemons through
 * this helper, never by calling runDaemon directly.
 */

export interface TestDaemonHandle {
  runtimeDir: string;
  /** Resolves when the daemon has fully shut down and removed its state. */
  done: Promise<void>;
  stop: () => Promise<void>;
}

const activeDaemons = new Set<TestDaemonHandle>();

export async function startTestDaemon(options: {
  runtimeDir: string;
  cwd: string;
  idleTimeoutMs?: number;
}): Promise<TestDaemonHandle> {
  const controller = new AbortController();
  const done = runDaemon({ ...options, signal: controller.signal });
  const handle: TestDaemonHandle = {
    runtimeDir: options.runtimeDir,
    done,
    stop: async () => {
      controller.abort();
      await done;
      activeDaemons.delete(handle);
    }
  };
  activeDaemons.add(handle);

  const paths = resolveDaemonPaths({ runtimeDir: options.runtimeDir });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2_000) {
    if (getDaemonStatus(paths).state === "running") {
      return handle;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  await handle.stop();
  throw new Error("test daemon did not reach running state");
}

export async function stopAllTestDaemons(): Promise<void> {
  for (const handle of [...activeDaemons]) {
    await handle.stop();
  }
}

// Enforced teardown: registered by the harness itself the moment a test file
// imports it, not left to each test's discipline.
afterEach(async () => {
  await stopAllTestDaemons();
});
