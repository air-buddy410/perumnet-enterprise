import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./server/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:perumnet.local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
