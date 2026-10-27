import {
  finishRecordingSchema,
  renameTranscriptSchema,
  startRecordingSchema,
  type SegmentDTO,
  type TranscriptDTO,
  type TranscriptListResponse,
  type TranscriptResponse,
} from "@stt/shared";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { transcribeAudioBuffer } from "../lib/stt/groq";
import { transcribeGemini } from "../lib/stt/gemini";
import { transcribeWhistle } from "../lib/stt/whistle";
import type { Transcription } from "../lib/stt/whisper";
import { db } from "../db";
import { env } from "../env";
import { segments, transcripts, type TranscriptRow } from "../db/schema";
import { recordAudit } from "../lib/audit";
import { requireAuth } from "../lib/auth-guard";
import { errors } from "../lib/errors";
import { parseBody } from "../lib/http";
import { limits } from "../lib/limits";
import { appendChunk, discardStaged, readStaged } from "../lib/recording-store";
import { findOwnedTranscript } from "../lib/transcript-access";
import { getStorage, type AudioRange } from "../lib/storage";
import { injectWebmDuration } from "../lib/webm";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const DB_ENGINE_MAP: Record<string, "whistle" | "gemini-live" | "groq-whisper"> = {
  whistle: "whistle",
  gemini: "gemini-live",
};

function currentUserId(request: FastifyRequest): string {
  if (!request.user) throw errors.unauthenticated();
  return request.user.id;
}

function toDTO(row: TranscriptRow): TranscriptDTO {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    language: row.language,
    engine: row.engine,
    durationMs: row.durationMs,
    audioAvailable: row.audioKey !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function encodeCursor(row: TranscriptRow): string {
  return `${row.createdAt.getTime()}_${row.id}`;
}

function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  const separator = raw.indexOf("_");
  if (separator <= 0) return null;
  const millis = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isInteger(millis) || millis <= 0 || id.length === 0) return null;
  return { createdAt: new Date(millis), id };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type AudioContainer = {
  mime: string;
  extension: "webm" | "m4a" | "ogg" | "wav" | "mp3";
};

export function containerFor(mime: string): AudioContainer | null {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (base) {
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return { mime: "audio/wav", extension: "wav" };
    case "audio/mpeg":
    case "audio/mp3":
      return { mime: "audio/mpeg", extension: "mp3" };
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
      return { mime: "audio/mp4", extension: "m4a" };
    case "audio/ogg":
    case "audio/opus":
      return { mime: "audio/ogg", extension: "ogg" };
    case "audio/webm":
      return { mime: "audio/webm", extension: "webm" };
    default:
      return null;
  }
}

function defaultTitle(now: Date): string {
  return `Recording · ${now.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function parseRange(header: string | undefined, size: number): AudioRange | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";

  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) return "invalid";

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    end = Math.min(end, size - 1);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
    return "invalid";
  }
  return { start, end };
}


export async function transcriptRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireAuth }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const userId = currentUserId(request);

    const search = (typeof query.q === "string" ? query.q.trim() : "").slice(0, 100);
    const rawLimit = typeof query.limit === "string" ? Number(query.limit) : DEFAULT_LIMIT;
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) {
      throw errors.validation({ limit: `Use a limit between 1 and ${MAX_LIMIT}` });
    }

    let cursor: { createdAt: Date; id: string } | null = null;
    if (typeof query.cursor === "string" && query.cursor.length > 0) {
      cursor = decodeCursor(query.cursor);
      if (!cursor) throw errors.validation({ cursor: "Invalid cursor" });
    }

    const filters = [eq(transcripts.userId, userId), isNull(transcripts.deletedAt)];
    if (search) {
      filters.push(sql`${transcripts.title} ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`);
    }
    if (cursor) {
      const older = or(
        lt(transcripts.createdAt, cursor.createdAt),
        and(eq(transcripts.createdAt, cursor.createdAt), lt(transcripts.id, cursor.id)),
      );
      if (older) filters.push(older);
    }

    const rows = await db
      .select()
      .from(transcripts)
      .where(and(...filters))
      .orderBy(desc(transcripts.createdAt), desc(transcripts.id))
      .limit(rawLimit + 1);

    const page = rows.slice(0, rawLimit);
    const last = page.at(-1);
    const response: TranscriptListResponse = {
      items: page.map(toDTO),
      nextCursor: rows.length > rawLimit && last ? encodeCursor(last) : null,
    };
    return response;
  });

  app.get("/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const row = await findOwnedTranscript(currentUserId(request), id);

    const stored = await db
      .select()
      .from(segments)
      .where(eq(segments.transcriptId, row.id))
      .orderBy(segments.seq);

    const response: TranscriptResponse = {
      transcript: toDTO(row),
      segments: stored.map((segment) => ({
        id: segment.id,
        seq: segment.seq,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
      })),
    };
    return response;
  });

  app.post("/", { preHandler: requireAuth, config: { rateLimit: limits.recordStart } }, async (request, reply) => {
    const userId = currentUserId(request);
    const input = parseBody(startRecordingSchema, request.body);
    const now = new Date();
    const effectiveEngine = input.engine ?? env.STT_PROVIDER;
    const selectedEngine = DB_ENGINE_MAP[effectiveEngine] ?? "groq-whisper";

    const [row] = await db
      .insert(transcripts)
      .values({
        userId,
        title: defaultTitle(now),
        status: "recording",
        engine: selectedEngine,
        audioMime: (containerFor(input.mime) ?? { mime: "audio/webm" }).mime,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) throw errors.internal();

    await recordAudit({
      action: "recording.started",
      actorUserId: userId,
      target: row.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      metadata: { mime: input.mime },
    });

    reply.code(201);
    const response: TranscriptResponse = { transcript: toDTO(row) };
    return response;
  });

  app.post("/upload", { preHandler: requireAuth, config: { rateLimit: limits.upload } }, async (request, reply) => {
    const userId = currentUserId(request);
    const query = request.query as Record<string, string | undefined>;
    const body = request.body;
    if (!(body instanceof Uint8Array) || body.byteLength === 0) {
      throw errors.validation({ audio: "Audio file is empty" });
    }

    const rawName = query.name ? String(query.name).trim() : "";
    const cleanTitle = rawName
      ? rawName.replace(/\.[a-zA-Z0-9]+$/, "").trim()
      : `Upload · ${new Date().toLocaleDateString()}`;
    const selectedEngine = DB_ENGINE_MAP[query.engine ? String(query.engine) : ""] ?? "groq-whisper";

    const contentType = (request.headers["content-type"] || "audio/wav").split(";")[0]?.trim() || "audio/wav";
    const container = containerFor(contentType);
    if (!container) {
      throw errors.unsupportedMediaType(`Audio format ${contentType} is not supported`);
    }
    const transcriptId = randomUUID();
    const key = `audio/${userId}/${transcriptId}.${container.extension}`;

    let transcription: Transcription;
    try {
      switch (selectedEngine) {
        case "gemini-live":
          transcription = await transcribeGemini(body, undefined, container.mime);
          break;
        case "whistle":
          transcription = await transcribeWhistle(
            body,
            undefined,
            rawName || `audio.${container.extension}`,
            container.mime,
          );
          break;
        default:
          transcription = await transcribeAudioBuffer(body, contentType, rawName || `audio.${container.extension}`);
          break;
      }
    } catch (err) {
      throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const lastWordEnd = transcription.words.at(-1)?.endMs ?? 0;
    const durationMs = lastWordEnd > 0 ? Math.round(lastWordEnd) : 0;

    const now = new Date();
    const [row, segmentRows] = await db.transaction(async (tx) => {
      const [newRow] = await tx
        .insert(transcripts)
        .values({
          id: transcriptId,
          userId,
          title: cleanTitle || "Uploaded Audio",
          status: "ready",
          engine: selectedEngine,
          language: transcription.language,
          durationMs,
          audioKey: key,
          audioMime: container.mime,
          audioBytes: body.byteLength,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!newRow) throw errors.internal();

      const segs: SegmentDTO[] = [];
      if (transcription.text) {
        const [savedSeg] = await tx
          .insert(segments)
          .values({
            transcriptId: newRow.id,
            seq: 0,
            text: transcription.text,
            startMs: 0,
            endMs: durationMs,
          })
          .returning();
        if (savedSeg) {
          segs.push({
            id: savedSeg.id,
            seq: savedSeg.seq,
            text: savedSeg.text,
            startMs: savedSeg.startMs,
            endMs: savedSeg.endMs,
          });
        }
      }
      return [newRow, segs] as const;
    });

    const storage = getStorage();
    try {
      await storage.put({ key, contentType: container.mime, bytes: body });
    } catch (storageErr) {
      await db.delete(transcripts).where(eq(transcripts.id, transcriptId)).catch(() => {});
      throw storageErr;
    }

    reply.code(201);
    return {
      transcript: toDTO(row),
      segments: segmentRows,
    };
  });

  app.post(
    "/:id/chunks",
    { preHandler: requireAuth, bodyLimit: env.MAX_CHUNK_BYTES },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = currentUserId(request);
      const query = request.query as Record<string, unknown>;
      const seq = Number(query.seq);
      if (!Number.isInteger(seq) || seq < 0) {
        throw errors.validation({ seq: "seq must be a non-negative integer" });
      }

      const body = request.body;
      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        throw errors.validation({ body: "Chunk body is empty" });
      }

      const result = await appendChunk(id, userId, seq, body);
      if (result.duplicate) return reply.code(204).send();

      reply.code(202);
      return { chunkSeq: result.chunkSeq, bytes: result.bytes };
    },
  );

  app.post("/:id/finish", { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = currentUserId(request);
    const input = parseBody(finishRecordingSchema, request.body);
    const row = await findOwnedTranscript(userId, id);

    if (row.status === "ready") {
      await discardStaged(id).catch(() => {});
      const existing: TranscriptResponse = { transcript: toDTO(row) };
      return existing;
    }
    if (row.status !== "recording") throw errors.stateConflict("Recording is not active");

    const bytes = row.audioBytes;
    const storage = getStorage();

    const [hasSegment] = await db
      .select({ id: segments.id })
      .from(segments)
      .where(eq(segments.transcriptId, id))
      .limit(1);
    const hasSegments = Boolean(hasSegment);

    if (bytes === 0 && !hasSegments) {
      await discardStaged(id);
      const [failed] = await db
        .update(transcripts)
        .set({ status: "failed", endedAt: new Date(), updatedAt: new Date() })
        .where(eq(transcripts.id, id))
        .returning();
      const response: TranscriptResponse = { transcript: toDTO(failed ?? row) };
      return response;
    }

    if (bytes === 0) {
      // Has segments but no audio chunks: mark ready with duration
      const [readyRow] = await db
        .update(transcripts)
        .set({
          status: "ready",
          durationMs: input.durationMs,
          endedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(transcripts.id, id))
        .returning();
      return { transcript: toDTO(readyRow ?? row) };
    }

    const container = containerFor(row.audioMime ?? "audio/webm") ?? { mime: "audio/webm", extension: "webm" as const };
    const key = `audio/${userId}/${id}.${container.extension}`;
    let audio = await readStaged(id, row.chunkSeq);
    if (container.extension === "webm") {
      audio = injectWebmDuration(audio, input.durationMs);
    }
    await storage.put({ key, contentType: container.mime, bytes: audio });

    const [updated] = await db
      .update(transcripts)
      .set({
        status: "ready",
        audioKey: key,
        audioMime: container.mime,
        audioBytes: audio.byteLength,
        durationMs: input.durationMs,
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(transcripts.id, id), eq(transcripts.status, "recording")))
      .returning();

    if (!updated) {
      const [current] = await db
        .select()
        .from(transcripts)
        .where(eq(transcripts.id, id));
      if (current?.status !== "ready") {
        throw errors.stateConflict("Recording is not active");
      }
      await discardStaged(id).catch(() => {});
      const existing: TranscriptResponse = { transcript: toDTO(current) };
      return existing;
    }

    // The audio is durable now. Staged rows are disposable; a failed delete
    // must not turn a successful recording into an error.
    await discardStaged(id).catch(() => {});

    await recordAudit({
      action: "recording.finished",
      actorUserId: userId,
      target: id,
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      metadata: { bytes: audio.byteLength, durationMs: input.durationMs },
    });

    const response: TranscriptResponse = { transcript: toDTO(updated ?? row) };
    return response;
  });

  app.post("/:id/abort", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = currentUserId(request);
    const row = await findOwnedTranscript(userId, id);

    if (row.status === "recording") {
      await discardStaged(id);
      await db
        .update(transcripts)
        .set({ status: "failed", endedAt: new Date(), updatedAt: new Date() })
        .where(eq(transcripts.id, id));
      await recordAudit({
        action: "recording.aborted",
        actorUserId: userId,
        target: id,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
    }

    return reply.code(204).send();
  });

  app.get("/:id/audio", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await findOwnedTranscript(currentUserId(request), id);
    if (!row.audioKey) throw errors.notFound("This transcript has no audio");

    const storage = getStorage();
    const size = await storage.size(row.audioKey);
    if (size === null) throw errors.notFound("Audio file is missing");

    const parsed = parseRange(request.headers.range, size);
    if (parsed === "invalid") {
      return reply.code(416).header("content-range", `bytes */${size}`).send();
    }

    const audio = await storage.read(row.audioKey, parsed ?? undefined);
    if (!audio) throw errors.notFound("Audio file is missing");

    reply
      .code(audio.status)
      .header("content-type", row.audioMime ?? "audio/webm")
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", "inline");

    for (const [name, value] of Object.entries(audio.headers)) reply.header(name, value);

    return reply.send(Readable.fromWeb(audio.body as WebReadableStream));
  });

  app.patch("/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = currentUserId(request);
    const input = parseBody(renameTranscriptSchema, request.body);
    const row = await findOwnedTranscript(userId, id);

    if (row.title === input.title) {
      const unchanged: TranscriptResponse = { transcript: toDTO(row) };
      return unchanged;
    }

    const [updated] = await db
      .update(transcripts)
      .set({ title: input.title, updatedAt: new Date() })
      .where(eq(transcripts.id, row.id))
      .returning();

    await recordAudit({
      action: "transcript.renamed",
      actorUserId: userId,
      target: row.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      metadata: { from: row.title, to: input.title },
    });

    const response: TranscriptResponse = { transcript: toDTO(updated ?? row) };
    return response;
  });

  app.delete("/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = currentUserId(request);
    const row = await findOwnedTranscript(userId, id);

    await db.update(transcripts).set({ deletedAt: new Date() }).where(eq(transcripts.id, row.id));
    if (row.audioKey) await getStorage().remove(row.audioKey);
    await discardStaged(id).catch(() => {});

    await recordAudit({
      action: "transcript.deleted",
      actorUserId: userId,
      target: row.id,
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      metadata: { title: row.title },
    });

    return reply.status(204).send();
  });
}
