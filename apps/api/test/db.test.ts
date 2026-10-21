import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/db";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";

test("the application database is PostgreSQL", async () => {
  const rows = await sqlClient.unsafe<{ version: string }[]>("select version()");
  expect(rows[0]?.version).toContain("PostgreSQL");
});

test("timestamps round-trip as Date objects", async () => {
  const [row] = await db
    .insert(users)
    .values({
      email: `timestamp-${randomUUID()}@example.com`,
      firstName: "Timestamp",
      lastName: "Check",
      passwordHash: "not-a-real-hash",
    })
    .returning();
  if (!row) throw new Error("insert returned no row");

  expect(row.createdAt).toBeInstanceOf(Date);
  expect(row.updatedAt).toBeInstanceOf(Date);

  const [stored] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, row.id));
  expect(stored?.createdAt).toBeInstanceOf(Date);
});
