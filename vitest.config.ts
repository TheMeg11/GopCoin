import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", setupFiles: ["./tests/setup.ts"], testTimeout: 60_000, fileParallelism: false,
    // integration.test.ts needs a live PostgreSQL — it is driven by tests/e2e-db.mjs
    exclude: ["tests/integration.test.ts", "**/node_modules/**"] },
});
