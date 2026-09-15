import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000
  },
  resolve: {
    alias: {
      "@ai-prompt-registry/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@ai-prompt-registry/sdk": path.resolve(__dirname, "packages/sdk/src/index.ts")
    }
  }
});
