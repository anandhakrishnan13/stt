import { sqlClient } from "../src/db";

export async function resetDb(): Promise<void> {
  await sqlClient.unsafe(
    "TRUNCATE TABLE audit_events, email_otps, refresh_tokens, segments, transcripts, users RESTART IDENTITY CASCADE",
  );
}
