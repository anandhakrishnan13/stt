import type { SegmentDTO, StreamCommand, StreamEvent } from "@stt/shared";
import { desc, eq, max, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { setTimeout as delay } from "node:timers/promises";
import type { WebSocket } from "ws";
import { db } from "../db";
import { segments, transcripts } from "../db/schema";
import { env } from "../env";
import { requireAuth } from "../lib/auth-guard";
import { SttRateLimitError, transcribePcm } from "../lib/stt";
import { commonPrefix, joinWords } from "../lib/stt/agreement";
import { pcm16Rms, SAMPLE_RATE, type Word } from "../lib/stt/audio";
import { SILENCE_LANGUAGES } from "../lib/stt/whisper";
import { findOwnedTranscript } from "../lib/transcript-access";

const SAMPLES_PER_MS = SAMPLE_RATE / 1_000;
const CONTEXT_CHARS = env.STT_CONTEXT_CHARS;
const MAX_BUFFER_MS = env.STT_MAX_BUFFER_MS;
const ERROR_COOLDOWN_MS = env.STT_ERROR_COOLDOWN_MS;
/** Whisper hallucinates on near-empty audio, so the final pass needs a floor. */
const FINAL_MIN_WINDOW_MS = 200;
/** Longest a stop request waits for a rate-limit cooldown before giving up. */
const MAX_FINAL_COOLDOWN_WAIT_MS = env.STT_MAX_FINAL_COOLDOWN_WAIT_MS;
const RETRY_TIMER_SLACK_MS = 50;

function durationOf(bytes: Buffer): number {
  return bytes.byteLength / 2 / SAMPLES_PER_MS;
}

function titleFromSpeech(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}…` : clean;
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

  const STT_ENGINE_MAP: Record<string, "whistle" | "gemini" | "groq"> = {
    whistle: "whistle",
    "gemini-live": "gemini",
    gemini: "gemini",
  };
  const sttEngine = STT_ENGINE_MAP[row.engine ?? ""] ?? "groq";
  const currentEngineName =
    row.engine ?? (sttEngine === "whistle" ? "whistle" : sttEngine === "gemini" ? "gemini-live" : "groq-whisper");
  const [latest] = await db
    .select({ seq: max(segments.seq) })
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId));
  let nextSeq = (latest?.seq ?? -1) + 1;

  // A reconnect creates a fresh session. Seed it from the transcript's wall
  // clock and the last committed text so timestamps stay absolute and the
  // engine keeps its language/context instead of starting cold.
  const recent = await db
    .select({
      id: segments.id,
      seq: segments.seq,
      text: segments.text,
      startMs: segments.startMs,
      endMs: segments.endMs,
    })
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId))
    .orderBy(desc(segments.seq))
    .limit(3);
  recent.reverse();

  let buffer = Buffer.alloc(0);
  let bufferStartMs = Math.max(0, Date.now() - row.createdAt.getTime());
  let previousWords: Word[] = [];
  let lastInferredMs = 0;
  let detectedLanguage: string | null = row.language;
  let lastCommitted: SegmentDTO | null = recent.at(-1) ?? null;
  let context = recent
    .map((segment) => segment.text)
    .join(" ")
    .slice(-CONTEXT_CHARS)
    .trim();
  let stopped = false;
  let lastErrorAt = 0;
  let cooldownUntil = 0;
  let retryAbort: AbortController | null = null;
  let rotateTimer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const advance = (bytes: number): void => {
    const trimmed = Math.min(bytes, buffer.byteLength);
    buffer = buffer.subarray(trimmed);
    bufferStartMs += trimmed / 2 / SAMPLES_PER_MS;
  };

  const clearRetryTimer = (): void => {
    retryAbort?.abort();
    retryAbort = null;
  };

  const clearRotateTimer = (): void => {
    if (rotateTimer !== null) clearTimeout(rotateTimer);
    rotateTimer = null;
  };

  /**
   * Waits out an active rate-limit cooldown (bounded) so a final pass is not
   * dropped just because the user stopped while the engine was throttled.
   */
  const waitForCooldown = async (): Promise<void> => {
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) return;
    await delay(Math.min(remaining, MAX_FINAL_COOLDOWN_WAIT_MS));
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
    !/[.!?…।]$/.test(lastCommitted.text);

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
        .set({
          engine: currentEngineName,
          language: detectedLanguage,
          title: sql`case
            when ${transcripts.title} like ${"Recording · %"} then ${titleFromSpeech(text)}
            else ${transcripts.title}
          end`,
          updatedAt: new Date(),
        })
        .where(eq(transcripts.id, transcriptId));

      send({ type: "segment", segment });
    } catch {
      reportError("Could not save a transcript segment.");
    }
  };

  const runPass = async (final: boolean): Promise<void> => {
    if (!final && Date.now() < cooldownUntil) return;
    const availableMs = durationOf(buffer);
    if (availableMs < (final ? FINAL_MIN_WINDOW_MS : env.STT_MIN_WINDOW_MS)) return;
    if (!final && availableMs - lastInferredMs < env.STT_STEP_MS) return;

    const windowMs = Math.min(availableMs, env.STT_MAX_WINDOW_MS);
    const snapshotBytes = Math.min(
      buffer.byteLength,
      Math.round(windowMs * SAMPLES_PER_MS) * 2,
    );
    const snapshot = buffer.subarray(0, snapshotBytes);
    const snapshotStartMs = bufferStartMs;
    const snapshotMs = durationOf(snapshot);
    lastInferredMs = snapshotMs;
    const rms = pcm16Rms(snapshot);
    if (rms < env.STT_SILENCE_RMS) {
      if (previousWords.length > 0) {
        await commit(previousWords, snapshotStartMs);
        advance(snapshot.byteLength);
        previousWords = [];
        lastInferredMs = 0;
        send({ type: "interim", text: "" });
      } else if (snapshotMs >= env.STT_MAX_WINDOW_MS) {
        advance(snapshot.byteLength);
        previousWords = [];
        lastInferredMs = 0;
      }
      return;
    }

    try {
      const result = await transcribePcm(
        snapshot,
        context || undefined,
        sttEngine,
        undefined,
      );
      if (result.language && !SILENCE_LANGUAGES.has(result.language.toLowerCase())) {
        detectedLanguage = detectedLanguage ?? result.language;
      }
      if (result.words.length === 0) return;

      if (
        lastCommitted &&
        result.text.length > 5 &&
        result.text.trim().toLowerCase() === lastCommitted.text.trim().toLowerCase() &&
        rms < 350
      ) {
        return;
      }
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
    } catch (error) {
      if (error instanceof SttRateLimitError) {
        cooldownUntil = Date.now() + error.retryAfterMs;
        lastInferredMs = 0;
        reportError(
          `Transcription is rate limited; retrying in ${Math.ceil(error.retryAfterMs / 1000)}s.`,
        );
        // A stop/close clears this timer, so a closed socket never keeps it alive.
        if (stopped) return;
        clearRetryTimer();
        const controller = new AbortController();
        retryAbort = controller;
        void delay(error.retryAfterMs + RETRY_TIMER_SLACK_MS, undefined, {
          signal: controller.signal,
        })
          .then(() => {
            retryAbort = null;
            kick();
          })
          .catch(() => {
            /* cancelled by stop/close */
          });
        return;
      }
      reportError("Transcription engine did not answer; retrying");
    }
  };

  const schedule = (final: boolean): Promise<void> => {
    chain = chain.then(() => runPass(final));
    return chain;
  };

  /**
   * Flushes the tail before the socket goes away: waits out a rate-limit
   * cooldown and retries once, so stopping mid-cooldown still persists audio.
   */
  const flushFinal = async (): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await waitForCooldown();
      await schedule(true);
      if (Date.now() >= cooldownUntil) break;
    }
  };

  /** Keeps working through buffered audio without waiting for the next frame. */
  const kick = (): void => {
    if (stopped) return;
    if (Date.now() < cooldownUntil) return;
    if (durationOf(buffer) - lastInferredMs < env.STT_STEP_MS) return;
    void schedule(false).then(() => {
      if (durationOf(buffer) - lastInferredMs >= env.STT_STEP_MS) kick();
    });
  };

  const finish = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearRetryTimer();
    clearRotateTimer();
    await flushFinal();
    send({ type: "done" });
    socket.close(1000, "done");
  };

  /**
   * Vercel closes the socket at the function duration cap. Flush first and ask
   * the client to reconnect, so the tail is committed instead of dropped.
   */
  const rotate = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearRetryTimer();
    clearRotateTimer();
    try {
      await flushFinal();
    } finally {
      send({ type: "rotate" });
      socket.close(1000, "rotate");
    }
  };

  send({ type: "ready", transcriptId });
  rotateTimer = setTimeout(() => void rotate(), env.WS_SESSION_MAX_MS);
  rotateTimer.unref?.();

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
    if (stopped) return;
    stopped = true;
    clearRetryTimer();
    clearRotateTimer();
    // The socket is gone, so `done` cannot be sent, but the tail is still worth
    // persisting — including when the close happens during a cooldown.
    if (buffer.byteLength > 0) void flushFinal();
  });

  socket.on("error", () => {
    stopped = true;
    clearRetryTimer();
    clearRotateTimer();
  });
}
