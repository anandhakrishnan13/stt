import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { db, sqlClient } from "../src/db";
import { resetDb } from "./db";
import { transcripts, users } from "../src/db/schema";
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

type Started = { transcript: { id: string; status: string; audioAvailable: boolean } };

async function startRecording(cookie = ownerCookie, mime = "audio/webm;codecs=opus") {
  const res = await app.inject({
    method: "POST",
    url: "/transcripts",
    headers: { cookie },
    payload: { mime },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as Started).transcript;
}

function sendChunk(id: string, seq: number, bytes: Buffer, cookie = ownerCookie) {
  return app.inject({
    method: "POST",
    url: `/transcripts/${id}/chunks?seq=${seq}`,
    headers: { cookie, "content-type": "application/octet-stream" },
    payload: bytes,
  });
}

function finish(id: string, durationMs = 2_500, cookie = ownerCookie) {
  return app.inject({
    method: "POST",
    url: `/transcripts/${id}/finish`,
    headers: { cookie },
    payload: { durationMs },
  });
}

async function stagedRows(id: string): Promise<{ seq: number; size: number }[]> {
  return sqlClient.unsafe<{ seq: number; size: number }[]>(
    "select seq, length(bytes)::int as size from recording_chunks where transcript_id = $1 order by seq",
    [id],
  );
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

describe("recording pipeline", () => {
  test("opens a recording in progress and rejects unsupported containers", async () => {
    const created = await startRecording();
    expect(created.status).toBe("recording");
    expect(created.audioAvailable).toBe(false);

    const rejected = await app.inject({
      method: "POST",
      url: "/transcripts",
      headers: { cookie: ownerCookie },
      payload: { mime: "video/webm" },
    });
    expect(rejected.statusCode).toBe(400);
  });

  test("applies chunks strictly in order and ignores retries", async () => {
    const { id } = await startRecording();

    expect((await sendChunk(id, 0, Buffer.from("first"))).statusCode).toBe(202);
    expect((await sendChunk(id, 0, Buffer.from("first"))).statusCode).toBe(204);

    const gap = await sendChunk(id, 2, Buffer.from("third"));
    expect(gap.statusCode).toBe(409);

    const second = await sendChunk(id, 1, Buffer.from("-second"));
    expect(second.statusCode).toBe(202);
    expect((second.json() as { bytes: number }).bytes).toBe("first-second".length);
  });

  test("stores chunks in the database and ignores retries", async () => {
    const { id } = await startRecording();

    expect((await sendChunk(id, 0, Buffer.from("first"))).statusCode).toBe(202);
    expect((await sendChunk(id, 0, Buffer.from("first"))).statusCode).toBe(204);
    expect((await sendChunk(id, 1, Buffer.from("-second"))).statusCode).toBe(202);

    expect(await stagedRows(id)).toEqual([
      { seq: 0, size: 5 },
      { seq: 1, size: 7 },
    ]);

    const [row] = await db
      .select({ audioBytes: transcripts.audioBytes })
      .from(transcripts)
      .where(eq(transcripts.id, id));
    expect(row?.audioBytes).toBe(12);
  });

  test("finishing removes staged chunks", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("audio"));
    expect(await stagedRows(id)).toHaveLength(1);

    expect((await finish(id)).statusCode).toBe(200);
    expect(await stagedRows(id)).toEqual([]);
  });

  test("aborting removes staged chunks", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("audio"));

    const aborted = await app.inject({
      method: "POST",
      url: `/transcripts/${id}/abort`,
      headers: { cookie: ownerCookie },
    });
    expect(aborted.statusCode).toBe(204);
    expect(await stagedRows(id)).toEqual([]);
  });

  test("deleting an unfinished recording removes staged chunks", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("audio"));

    const deleted = await app.inject({
      method: "DELETE",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await stagedRows(id)).toEqual([]);
  });

  test("refuses to finish when a staged chunk is missing", async () => {
    const { id } = await startRecording();
    await sqlClient.unsafe(
      "insert into recording_chunks (transcript_id, seq, bytes, created_at) values ($1, $2, $3, now()), ($1, $4, $5, now())",
      [id, 0, Buffer.from("a"), 2, Buffer.from("c")],
    );
    await db
      .update(transcripts)
      .set({ chunkSeq: 2, audioBytes: 2 })
      .where(eq(transcripts.id, id));

    const res = await finish(id);
    expect(res.statusCode).toBe(409);
    expect(await stagedRows(id)).toHaveLength(2);
  });

  test("stores the assembled audio and serves it with range support", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("01234567"));
    await sendChunk(id, 1, Buffer.from("89abcdef"));

    const done = await finish(id, 3_000);
    expect(done.statusCode).toBe(200);
    const finished = (done.json() as Started & { transcript: { durationMs: number } }).transcript;
    expect(finished.status).toBe("ready");
    expect(finished.audioAvailable).toBe(true);
    expect((done.json() as { transcript: { durationMs: number } }).transcript.durationMs).toBe(3000);

    const full = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: ownerCookie },
    });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("audio/webm");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.body).toBe("0123456789abcdef");

    const ranged = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: ownerCookie, range: "bytes=4-7" },
    });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-range"]).toBe("bytes 4-7/16");
    expect(ranged.body).toBe("4567");

    const suffix = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: ownerCookie, range: "bytes=-4" },
    });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.body).toBe("cdef");

    const unsatisfiable = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: ownerCookie, range: "bytes=99-120" },
    });
    expect(unsatisfiable.statusCode).toBe(416);
    expect(unsatisfiable.headers["content-range"]).toBe("bytes */16");
  });

  test("finishing twice keeps the first result", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("audio"));

    const first = await finish(id, 1_000);
    const second = await finish(id, 9_999);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { transcript: { durationMs: number } }).transcript.durationMs).toBe(
      1000,
    );
  });

  test("an empty recording finishes as failed without audio", async () => {
    const { id } = await startRecording();
    const res = await finish(id);
    expect(res.statusCode).toBe(200);
    const transcript = (res.json() as Started).transcript;
    expect(transcript.status).toBe("failed");
    expect(transcript.audioAvailable).toBe(false);

    const audio = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: ownerCookie },
    });
    expect(audio.statusCode).toBe(404);
  });

  test("aborting discards chunks and closes the recording", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("audio"));

    const aborted = await app.inject({
      method: "POST",
      url: `/transcripts/${id}/abort`,
      headers: { cookie: ownerCookie },
    });
    expect(aborted.statusCode).toBe(204);

    const late = await sendChunk(id, 1, Buffer.from("more"));
    expect(late.statusCode).toBe(409);

    const status = await app.inject({
      method: "GET",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
    });
    expect((status.json() as Started).transcript.status).toBe("failed");
  });

  test("another user cannot touch the recording", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("audio"));

    expect((await sendChunk(id, 1, Buffer.from("x"), strangerCookie)).statusCode).toBe(404);
    expect((await finish(id, 1_000, strangerCookie)).statusCode).toBe(404);

    const audio = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: strangerCookie },
    });
    expect(audio.statusCode).toBe(404);

    const abort = await app.inject({
      method: "POST",
      url: `/transcripts/${id}/abort`,
      headers: { cookie: strangerCookie },
    });
    expect(abort.statusCode).toBe(404);
  });

  test("deleting a transcript removes its stored audio", async () => {
    const { id } = await startRecording();
    await sendChunk(id, 0, Buffer.from("audio"));
    await finish(id);

    await app.inject({
      method: "DELETE",
      url: `/transcripts/${id}`,
      headers: { cookie: ownerCookie },
    });

    const audio = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: ownerCookie },
    });
    expect(audio.statusCode).toBe(404);
  });

  test("keeps Safari's fragmented mp4 as m4a", async () => {
    const { id } = await startRecording(ownerCookie, "audio/mp4");
    await sendChunk(id, 0, Buffer.from("mp4-bytes"));
    await finish(id);

    const audio = await app.inject({
      method: "GET",
      url: `/transcripts/${id}/audio`,
      headers: { cookie: ownerCookie },
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/mp4");
    expect(audio.body).toBe("mp4-bytes");
  });

  test("rejects empty chunk bodies", async () => {
    const { id } = await startRecording();
    const res = await sendChunk(id, 0, Buffer.alloc(0));
    expect(res.statusCode).toBe(400);
  });
});
