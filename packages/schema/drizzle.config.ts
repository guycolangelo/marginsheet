import { defineConfig } from "drizzle-kit";

// Migrations are generated into migrations/ and checked in. They are never
// applied from a live introspection diff: a reviewable SQL file is the
// artifact, and CI proves it runs up and down against a real branch.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
