import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default is 5s, which is a statement about LOCAL latency. Every
    // database-backed test here makes real TLS round trips to a remote
    // Postgres, and on 17 Aug 2026 one of them crossed 5s while the suite ran
    // at 370s against its usual 170s: a red produced by provisioning jitter
    // rather than by anything being wrong.
    //
    // RAISED BECAUSE THE DEFAULT DESCRIBED LOCAL LATENCY AND THESE TESTS ARE
    // REMOTE, not because a test was slow. globalSetup enforces a budget on the
    // whole run so that distinction stays checkable rather than becoming a
    // place for a real regression to hide.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    globalSetup: ["./test/helpers/suite-duration.ts"],
  },
});
