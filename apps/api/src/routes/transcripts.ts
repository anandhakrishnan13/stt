import {
  renameTranscriptSchema,
  type TranscriptDTO,
  type TranscriptListResponse,
  type TranscriptResponse,
} from "@stt/shared";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "../db";
import { transcripts, type TranscriptRow } from "../db/schema";
import { recordAudit } from "../lib/audit";
import { requireAuth } from "../lib/auth-guard";
import { errors } from "../lib/errors";
import { parseBody } from "../lib/http";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

function currentUserId(request: FastifyRequest): string {
  if (!request.user) throw errors.unauthenticated();
  return request.user.id;
}

function toDTO(row: TranscriptRow): TranscriptDTO {
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    engine: row.engine,
    durationMs: row.durationMs,
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

/** Ownership is part of the lookup: another user's row is indistinguishable from a missing one. */
async function ownedTranscript(userId: string, id: string): Promise<TranscriptRow> {
  const [row] = await db
    .select()
    .from(transcripts)
    .where(
      and(
        eq(transcripts.id, id),
        eq(transcripts.userId, userId),
        isNull(transcripts.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw errors.notFound("Transcript not found");
  return row;
}

export async function transcriptRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireAuth }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const userId = currentUserId(request);

    const search = typeof query.q === "string" ? query.q.trim() : "";
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
      filters.push(sql`${transcripts.title} LIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`);
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
    const row = await ownedTranscript(currentUserId(request), id);
    const response: TranscriptResponse = { transcript: toDTO(row) };
    return response;
  });

  app.patch("/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = currentUserId(request);
    const input = parseBody(renameTranscriptSchema, request.body);
    const row = await ownedTranscript(userId, id);

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
    const row = await ownedTranscript(userId, id);

    await db.update(transcripts).set({ deletedAt: new Date() }).where(eq(transcripts.id, row.id));
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
