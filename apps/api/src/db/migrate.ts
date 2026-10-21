import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { env } from "../env";
import { sqlitePath } from "./index";

const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

export function runMigrations(url = env.DATABASE_URL): void {
  const client = new Database(sqlitePath(url), { create: true });
  try {
    migrate(drizzle(client), { migrationsFolder });
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  runMigrations();
  console.log("migrations applied");
}
