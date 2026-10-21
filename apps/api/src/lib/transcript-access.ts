import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { transcripts, type TranscriptRow } from "../db/schema";
import { errors } from "./errors";

/**
 * Ownership is part of the lookup: another user's row is indistinguishable from
 * a missing one, for REST and websocket callers alike.
 */
export async function findOwnedTranscript(
  userId: string,
  id: string,
): Promise<TranscriptRow> {
  const [row] = await db
    .select()
    .from(transcripts)
    .where(
      and(eq(transcripts.id, id), eq(transcripts.userId, userId), isNull(transcripts.deletedAt)),
    )
    .limit(1);
  if (!row) throw errors.notFound("Transcript not found");
  return row;
}
