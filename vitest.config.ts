import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@switchboard-mcp/core": resolve(__dirname, "packages/core/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    watch: false
  }
});
