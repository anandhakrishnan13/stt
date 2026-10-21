import type { SegmentDTO, StreamCommand, StreamEvent } from "@stt/shared";
import { eq, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { db } from "../db";
import { segments, transcripts } from "../db/schema";
import { env } from "../env";
import { requireAuth } from "../lib/auth-guard";
import { commonPrefix, joinWords } from "../lib/stt/agreement";
import { pcm16Rms, transcribePcm, type Word } from "../lib/stt/whisper";
import { findOwnedTranscript } from "../lib/transcript-access";

const SAMPLES_PER_MS = 16;
const CONTEXT_CHARS = 200;
const MAX_BUFFER_MS = 60_000;
const ERROR_COOLDOWN_MS = 5_000;

function durationOf(bytes: Buffer): number {
  return bytes.byteLength / 2 / SAMPLES_PER_MS;
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/:id/stream",
    { websocket: true, preValidation: [requireAuth] },
    (socket: WebSocket, request) => {
      const { id } = request.params as { id: string };
      if (!request.user) {
        socket.close(1008, "unauthenticated");
        return;
      }
      void runSession(socket, request.user.id, id);
    },
  );
}

/**
 * Streaming with LocalAgreement: each pass re-reads the uncommitted audio and
 * only the prefix that two consecutive hypotheses agree on is committed. That
 * keeps partial words out of the database while still showing text every couple
 * of seconds, and the accepted prefix is trimmed from the buffer so work stays
 * bounded.
 */
async function runSession(socket: WebSocket, userId: string, transcriptId: string): Promise<void> {
  const send = (event: StreamEvent): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  };

  let row;
  try {
    row = await findOwnedTranscript(userId, transcriptId);
  } catch {
    socket.close(1008, "transcript not found");
    return;
  }

  if (row.status !== "recording") {
    send({ type: "error", message: "This recording is no longer accepting audio" });
    socket.close(1008, "recording closed");
    return;
  }

  const [latest] = await db
    .select({ seq: max(segments.seq) })
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId));
  let nextSeq = (latest?.seq ?? -1) + 1;

  let buffer = Buffer.alloc(0);
  let bufferStartMs = 0;
  let previousWords: Word[] = [];
  let lastInferredMs = 0;
  let detectedLanguage: string | null = row.language;
  let lastCommitted: SegmentDTO | null = null;
  let context = "";
  let stopped = false;
  let lastErrorAt = 0;
  let chain: Promise<void> = Promise.resolve();

  const advance = (bytes: number): void => {
    const trimmed = Math.min(bytes, buffer.byteLength);
    buffer = buffer.subarray(trimmed);
    bufferStartMs += trimmed / 2 / SAMPLES_PER_MS;
  };

  const reportError = (message: string): void => {
    const now = Date.now();
    if (now - lastErrorAt < ERROR_COOLDOWN_MS) return;
    lastErrorAt = now;
    send({ type: "error", message });
  };

/** A word-boundary commit often splits a phrase; stitch nearby fragments. */
  const continues = (startMs: number): boolean =>
    lastCommitted !== null &&
    startMs - lastCommitted.endMs <= 600 &&
    !/[.!?…]$/.test(lastCommitted.text);

  const commit = async (words: Word[], startMs: number): Promise<void> => {
    const text = joinWords(words);
    if (!text) return;
    const endMs = startMs + Math.round(words.at(-1)?.endMs ?? 0);

    try {
      let segment: SegmentDTO;

      if (lastCommitted && continues(startMs)) {
        const merged = `${lastCommitted.text} ${text}`.replace(/\s+/g, " ").trim();
        const [updated] = await db
          .update(segments)
          .set({ text: merged, endMs })
          .where(eq(segments.id, lastCommitted.id))
          .returning();
        segment = {
          id: lastCommitted.id,
          seq: lastCommitted.seq,
          text: merged,
          startMs: lastCommitted.startMs,
          endMs,
        };
        context = `${context.slice(0, Math.max(0, context.length - lastCommitted.text.length))} ${merged}`
          .slice(-CONTEXT_CHARS)
          .trim();
        if (!updated) return;
      } else {
        const [saved] = await db
          .insert(segments)
          .values({ transcriptId, seq: nextSeq++, text, startMs, endMs })
          .returning();
        if (!saved) return;
        segment = {
          id: saved.id,
          seq: saved.seq,
          text: saved.text,
          startMs: saved.startMs,
          endMs: saved.endMs,
        };
        context = `${context} ${text}`.slice(-CONTEXT_CHARS).trim();
      }

      lastCommitted = segment;
      await db
        .update(transcripts)
        .set({ engine: "whisper-local", language: detectedLanguage, updatedAt: new Date() })
        .where(eq(transcripts.id, transcriptId));

      send({ type: "segment", segment });
    } catch {
      reportError("Could not save a transcript segment.");
    }
  };

  const runPass = async (final: boolean): Promise<void> => {
    const availableMs = durationOf(buffer);
    if (availableMs < env.STT_MIN_WINDOW_MS) return;
    if (!final && availableMs - lastInferredMs < env.STT_STEP_MS) return;

    const snapshot = buffer;
    const snapshotStartMs = bufferStartMs;
    const snapshotMs = availableMs;
    lastInferredMs = availableMs;

    if (pcm16Rms(snapshot) < env.STT_SILENCE_RMS) {
      if (snapshotMs >= env.STT_MAX_WINDOW_MS) {
        advance(snapshot.byteLength);
        previousWords = [];
        lastInferredMs = 0;
      }
      return;
    }

    try {
      const result = await transcribePcm(snapshot, context || undefined);
      detectedLanguage = detectedLanguage ?? result.language;
      if (result.words.length === 0) return;

      const forced = final || snapshotMs >= env.STT_MAX_WINDOW_MS;
      const agreed = forced ? result.words.length : commonPrefix(previousWords, result.words);

      if (agreed > 0) {
        const committed = result.words.slice(0, agreed);
        await commit(committed, snapshotStartMs);

        const trimMs = Math.min(Math.max(committed.at(-1)?.endMs ?? 0, 20), snapshotMs);
        const trimBytes = Math.min(snapshot.byteLength, Math.round(trimMs * SAMPLES_PER_MS) * 2);
        advance(trimBytes);
        lastInferredMs = Math.max(0, lastInferredMs - trimMs);

        previousWords = result.words.slice(agreed).map((word) => ({
          ...word,
          startMs: word.startMs - trimMs,
          endMs: word.endMs - trimMs,
        }));
      } else {
        previousWords = result.words;
      }

      const interim = joinWords(previousWords);
      if (interim) send({ type: "interim", text: interim });
    } catch {
      reportError("Transcription engine did not answer; retrying");
    }
  };

  const schedule = (final: boolean): Promise<void> => {
    chain = chain.then(() => runPass(final));
    return chain;
  };

  /** Keeps working through buffered audio without waiting for the next frame. */
  const kick = (): void => {
    if (stopped) return;
    if (durationOf(buffer) - lastInferredMs < env.STT_STEP_MS) return;
    void schedule(false).then(() => {
      if (durationOf(buffer) - lastInferredMs >= env.STT_STEP_MS) kick();
    });
  };

  const finish = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await schedule(true);
    send({ type: "done" });
    socket.close(1000, "done");
  };

  send({ type: "ready", transcriptId });

  socket.on("message", (data: Buffer, isBinary: boolean) => {
    if (stopped) return;

    if (isBinary) {
      if (data.byteLength === 0 || data.byteLength % 2 !== 0) return;
      buffer = Buffer.concat([buffer, data]);

      if (buffer.byteLength > MAX_BUFFER_MS * SAMPLES_PER_MS * 2) {
        reportError("Audio is arriving faster than it can be transcribed");
        socket.close(1011, "backpressure");
        return;
      }

      kick();
      return;
    }

    try {
      const command = JSON.parse(data.toString()) as StreamCommand;
      if (command.type === "stop") void finish();
    } catch {
      /* ignore malformed control frames */
    }
  });

  socket.on("close", () => {
    if (!stopped) {
      stopped = true;
      if (buffer.byteLength > 0) void schedule(true);
    }
  });

  socket.on("error", () => {
    stopped = true;
  });
}
