import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { resetDb } from "./db";
import { auditEvents, transcripts, users } from "../src/db/schema";
import { ACCESS_COOKIE } from "../src/lib/cookies";
import { signAccessToken } from "../src/lib/tokens";

let app: FastifyInstance;
let ownerId: string;
let strangerId: string;
let ownerCookie: string;
let strangerCookie: string;

async function createUser(email: string): Promise<string> {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    email,
    firstName: "Asha",
    lastName: "Rao",
    passwordHash: "unused-in-this-suite",
    status: "active",
    emailVerifiedAt: new Date(),
  });
  return id;
}

async function cookieFor(userId: string): Promise<string> {
  const token = await signAccessToken({ id: userId, tokenVersion: 0 });
  return `${ACCESS_COOKIE}=${token}`;
}

async function insertTranscript(
  userId: string,
  title: string,
  createdAt: Date,
  extra: Partial<typeof transcripts.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(transcripts).values({
    id,
    userId,
    title,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  });
  return id;
}

function get(path: string, cookie: string) {
  return app.inject({ method: "GET", url: path, headers: { cookie } });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDb();

  ownerId = await createUser("owner@example.com");
  strangerId = await createUser("stranger@example.com");
  ownerCookie = await cookieFor(ownerId);
  strangerCookie = await cookieFor(strangerId);
});

describe("transcript history", () => {
  test("answers the browser preflight for PATCH and DELETE", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: `/transcripts/${randomUUID()}`,
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.statusCode).toBe(204);
    const allowed = String(res.headers["access-control-allow-methods"]);
    expect(allowed).toContain("PATCH");
    expect(allowed).toContain("DELETE");
  });

  test("requires a session", async () => {
    const res = await app.inject({ method: "GET", url: "/transcripts" });
    expect(res.statusCode).toBe(401);
  });

  test("lists only the caller's transcripts, newest first", async () => {
    await insertTranscript(ownerId, "Standup notes", new Date("2026-10-20T09:00:00Z"));
    await insertTranscript(ownerId, "Client call", new Date("2026-10-21T09:00:00Z"));
    await insertTranscript(strangerId, "Not yours", new Date("2026-10-21T10:00:00Z"));

    const res = await get("/transcripts", ownerCookie);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { title: string }[]; nextCursor: string | null };
    expect(body.items.map((item) => item.title)).toEqual(["Client call", "Standup notes"]);
    expect(body.nextCursor).toBeNull();
  });

  test("searches titles and treats wildcards literally", async () => {
    await insertTranscript(ownerId, "Weekly sync", new Date("2026-10-21T09:00:00Z"));
    await insertTranscript(ownerId, "100% done", new Date("2026-10-21T09:05:00Z"));

    const match = await get("/transcripts?q=weekly", ownerCookie);
    expect((match.json() as { items: { title: string }[] }).items.map((i) => i.title)).toEqual([
      "Weekly sync",
    ]);

    const wildcard = await get("/transcripts?q=%25", ownerCookie);
    expect((wildcard.json() as { items: { title: string }[] }).items.map((i) => i.title)).toEqual([
      "100% done",
    ]);
  });

  test("paginates with an opaque cursor", async () => {
    for (let index = 0; index < 3; index += 1) {
      await insertTranscript(
        ownerId,
        `Session ${index}`,
        new Date(`2026-10-2${index}T09:00:00Z`),
      );
    }

    const first = await get("/transcripts?limit=2", ownerCookie);
    const firstBody = first.json() as { items: { title: string }[]; nextCursor: string | null };
    expect(firstBody.items.map((item) => item.title)).toEqual(["Session 2", "Session 1"]);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await get(`/transcripts?limit=2&cursor=${firstBody.nextCursor}`, ownerCookie);
    const secondBody = second.json() as { items: { title: string }[]; nextCursor: string | null };
    expect(secondBody.items.map((item) => item.title)).toEqual(["Session 0"]);
    expect(secondBody.nextCursor).toBeNull();

    const invalid = await get("/transcripts?cursor=nonsense", ownerCookie);
    expect(invalid.statusCode).toBe(400);
  });

  test("hides another user's transcript behind a 404", async () => {
    const id = await insertTranscript(strangerId, "Private", new Date());

    const read = await get(`/transcripts/${id}`, ownerCookie);
    expect(read.statusCode).toBe(404);

    const rename = await app.inject({
      method: "PATCH",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
      payload: { title: "Hijacked" },
    });
    expect(rename.statusCode).toBe(404);

    const remove = await app.inject({
      method: "DELETE",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
    });
    expect(remove.statusCode).toBe(404);
  });

  test("renames, validates the title and records an audit event", async () => {
    const id = await insertTranscript(ownerId, "Untitled", new Date());

    const renamed = await app.inject({
      method: "PATCH",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
      payload: { title: "  Product sync  " },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { transcript: { title: string } }).transcript.title).toBe(
      "Product sync",
    );

    const blank = await app.inject({
      method: "PATCH",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
      payload: { title: "   " },
    });
    expect(blank.statusCode).toBe(400);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.target, id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("transcript.renamed");
  });

  test("soft-deletes so the row survives but disappears from reads", async () => {
    const id = await insertTranscript(ownerId, "Temporary", new Date());

    const removed = await app.inject({
      method: "DELETE",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
    });
    expect(removed.statusCode).toBe(204);

    expect((await get(`/transcripts/${id}`, ownerCookie)).statusCode).toBe(404);
    const list = await get("/transcripts", ownerCookie);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(0);

    const [row] = await db.select().from(transcripts).where(eq(transcripts.id, id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  test("uploads an audio file and creates a ready transcript", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return Response.json({
        text: "Uploaded audio content transcribed successfully",
        language: "english",
        duration: 3.5,
        segments: [{ words: [{ word: "Uploaded", start: 0, end: 0.5 }] }],
      });
    }) as unknown as typeof fetch;

    try {
      const audioBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
      const res = await app.inject({
        method: "POST",
        url: "/transcripts/upload?name=meeting-notes.wav&engine=whisper",
        headers: {
          cookie: ownerCookie,
          "content-type": "audio/wav",
        },
        payload: audioBytes,
      });

      expect(res.statusCode).toBe(201);
      const json = res.json() as { transcript: { id: string; title: string; status: string; engine: string } };
      expect(json.transcript.title).toBe("meeting-notes");
      expect(json.transcript.status).toBe("ready");
      expect(json.transcript.engine).toBe("groq-whisper");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects unsupported media formats with 415", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/transcripts/upload?name=archive.zip",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/zip",
      },
      payload: Buffer.from("PK\x03\x04fakearchive"),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  test("stores and serves uploads with correct mime types and extensions", async () => {
    const formats = [
      { mime: "audio/wav", ext: "wav" },
      { mime: "audio/mpeg", ext: "mp3" },
      { mime: "audio/mp4", ext: "m4a" },
      { mime: "audio/ogg", ext: "ogg" },
      { mime: "audio/webm", ext: "webm" },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return Response.json({
        text: "Testing formats",
        language: "english",
        segments: [{ words: [{ word: "Testing", start: 0, end: 0.5 }] }],
      });
    }) as unknown as typeof fetch;

    try {
      for (const fmt of formats) {
        const uploadRes = await app.inject({
          method: "POST",
          url: `/transcripts/upload?name=test.${fmt.ext}`,
          headers: {
            cookie: ownerCookie,
            "content-type": fmt.mime,
          },
          payload: Buffer.from("RIFFtestdataWAVEfmt "),
        });
        expect(uploadRes.statusCode).toBe(201);
        const id = uploadRes.json().transcript.id;

        const audioRes = await app.inject({
          method: "GET",
          url: `/transcripts/${id}/audio`,
          headers: { cookie: ownerCookie },
        });
        expect(audioRes.statusCode).toBe(200);
        expect(audioRes.headers["content-type"]).toBe(fmt.mime);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
