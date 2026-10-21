import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sqlClient = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  prepare: false,
  ssl: env.DATABASE_SSL ? "require" : false,
  connect_timeout: 10,
  idle_timeout: 20,
  onnotice: () => {},
});

export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;

export async function closeDb(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}
