import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/drizzle/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH ?? "./data/native-trace.db",
  },
} satisfies Config;
