import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  // Components are written for Next's automatic JSX runtime.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // The database integration tests share one TEST_DATABASE_URL, and the
    // worker's reconcile step looks at every document, so files run one at
    // a time rather than interfering with each other.
    fileParallelism: false,
  },
});
