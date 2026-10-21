import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { env } from "../env";
import * as schema from "./schema";

export function sqlitePath(url: string): string {
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

export const sqlClient = new Database(sqlitePath(env.DATABASE_URL), { create: true });

sqlClient.exec("PRAGMA journal_mode = WAL;");
sqlClient.exec("PRAGMA foreign_keys = ON;");
sqlClient.exec("PRAGMA busy_timeout = 5000;");

export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;

export async function closeDb(): Promise<void> {
  sqlClient.close();
}
