import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { recordingChunks, transcripts } from "../db/schema";
import { env } from "../env";
import { errors } from "./errors";

/**
 * Chunks arrive one request at a time while the browser is recording. They are
 * staged in Postgres so any function instance can accept the next chunk, then
 * promoted to the configured object storage on finish.
 */

export type AppendChunkResult = {
  duplicate: boolean;
  chunkSeq: number;
  bytes: number;
};

const incomplete = () =>
  errors.stateConflict("Recording is incomplete; upload the missing chunk and retry");

async function totalBytes(
  tx: Pick<typeof db, "select">,
  transcriptId: string,
): Promise<number> {
  const [row] = await tx
    .select({
      bytes: sql<number>`coalesce(sum(length(${recordingChunks.bytes})), 0)`,
    })
    .from(recordingChunks)
    .where(eq(recordingChunks.transcriptId, transcriptId));
  return Number(row?.bytes ?? 0);
}

/**
 * Locks the transcript row, so two function instances cannot both apply the
 * same sequence number or interleave a finish with a late chunk.
 */
export async function appendChunk(
  transcriptId: string,
  seq: number,
  chunk: Uint8Array,
): Promise<AppendChunkResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: transcripts.status,
        chunkSeq: transcripts.chunkSeq,
        audioBytes: transcripts.audioBytes,
      })
      .from(transcripts)
      .where(eq(transcripts.id, transcriptId))
      .for("update");

    if (!row) throw errors.notFound("Transcript not found");
    if (row.status !== "recording") {
      throw errors.stateConflict("Recording is no longer active");
    }

    // Retries of an already-applied chunk are harmless no-ops.
    if (seq <= row.chunkSeq) {
      return { duplicate: true, chunkSeq: row.chunkSeq, bytes: row.audioBytes };
    }
    if (seq !== row.chunkSeq + 1) {
      throw errors.stateConflict(`Expected chunk ${row.chunkSeq + 1}, received ${seq}`);
    }

    const current = await totalBytes(tx, transcriptId);
    if (current + chunk.byteLength > env.MAX_AUDIO_BYTES) {
      throw errors.payloadTooLarge("Recording exceeded the size limit");
    }

    const [inserted] = await tx
      .insert(recordingChunks)
      .values({ transcriptId, seq, bytes: Buffer.from(chunk) })
      .onConflictDoNothing()
      .returning({ seq: recordingChunks.seq });

    if (!inserted) {
      // Another instance inserted the same sequence first; its transaction
      // also advanced chunkSeq, so this request is a retry.
      return { duplicate: true, chunkSeq: row.chunkSeq, bytes: row.audioBytes };
    }

    const [updated] = await tx
      .update(transcripts)
      .set({
        chunkSeq: seq,
        audioBytes: current + chunk.byteLength,
        updatedAt: new Date(),
      })
      .where(eq(transcripts.id, transcriptId))
      .returning({
        chunkSeq: transcripts.chunkSeq,
        audioBytes: transcripts.audioBytes,
      });

    if (!updated) throw errors.internal();
    return {
      duplicate: false,
      chunkSeq: updated.chunkSeq,
      bytes: updated.audioBytes,
    };
  });
}

export async function stagedBytes(transcriptId: string): Promise<number> {
  return totalBytes(db, transcriptId);
}

export async function readStaged(
  transcriptId: string,
  expectedLastSeq: number,
): Promise<Uint8Array> {
  const rows = await db
    .select({ seq: recordingChunks.seq, bytes: recordingChunks.bytes })
    .from(recordingChunks)
    .where(eq(recordingChunks.transcriptId, transcriptId))
    .orderBy(asc(recordingChunks.seq));

  if (rows.length !== expectedLastSeq + 1) throw incomplete();
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.seq !== index) throw incomplete();
  }

  return Buffer.concat(rows.map((row) => Buffer.from(row.bytes)));
}

export async function discardStaged(transcriptId: string): Promise<void> {
  await db.delete(recordingChunks).where(eq(recordingChunks.transcriptId, transcriptId));
}
