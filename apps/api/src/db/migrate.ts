import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env";

const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

export async function runMigrations(
  url = env.DATABASE_URL,
  ssl = env.DATABASE_SSL,
): Promise<void> {
  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: ssl ? "require" : false,
    onnotice: () => {},
  });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  await runMigrations();
  console.log("migrations applied");
}
