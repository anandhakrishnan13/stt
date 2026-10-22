import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sqlClient = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  prepare: false,
  ssl: env.DATABASE_SSL ? "require" : false,
  connect_timeout: env.DATABASE_CONNECT_TIMEOUT_SECONDS,
  idle_timeout: env.DATABASE_IDLE_TIMEOUT_SECONDS,
  max_lifetime: env.DATABASE_MAX_LIFETIME_SECONDS,
  onnotice: () => {},
});

export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;

export async function closeDb(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}
