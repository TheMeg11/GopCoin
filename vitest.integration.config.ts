import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Config for the DB integration suite (driven by tests/e2e-db.mjs, which boots a real
 * embedded PostgreSQL and points DATABASE_URL at it). Unlike vitest.config.ts this does
 * NOT exclude tests/integration.test.ts.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", setupFiles: ["./tests/setup.ts"], testTimeout: 60_000, fileParallelism: false },
});
