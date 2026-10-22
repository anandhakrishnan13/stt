import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { segments, transcripts, users } from "../src/db/schema";
import { env } from "../src/env";
import { ACCESS_COOKIE } from "../src/lib/cookies";
import { signAccessToken } from "../src/lib/tokens";
import { resetDb } from "./db";

let app: FastifyInstance;
let wsUrlBase: string;
let ownerId: string;
let cookie: string;
const originalFetch = globalThis.fetch;

const STUB_TEXT = "Hello from the test";
/** Number of upcoming transcription calls that should answer HTTP 429. */
let rateLimitResponses = 0;
const uploadSizes: number[] = [];
const prompts: string[] = [];

function tone(seconds: number): Uint8Array {
  const samples = Math.round(16_000 * seconds);
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples; index += 1) {
    view.setInt16(index * 2, index % 2 === 0 ? 1200 : -1200, true);
  }
  return bytes;
}

function waitForEvent(
  socket: WebSocket,
  type: string,
  timeoutMs = 8_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (data.type !== type) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(data);
    };
    socket.addEventListener("message", onMessage);
  });
}

function openSocket(transcriptId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrlBase}/transcripts/${transcriptId}/stream`, {
      headers: { cookie: `${ACCESS_COOKIE}=${cookie}` },
    } as never);
    const timer = setTimeout(() => reject(new Error("socket open timed out")), 5_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("socket failed to open"));
    });
  });
}

/** Reads the text of a `segment` stream event, validating the shape. */
function segmentText(event: Record<string, unknown>): string {
  const segment = event.segment;
  if (typeof segment !== "object" || segment === null || !("text" in segment)) {
    throw new Error("event carried no segment text");
  }
  return String(segment.text);
}

async function createRecording(title: string): Promise<string> {
  const id = randomUUID();
  await db.insert(transcripts).values({
    id,
    userId: ownerId,
    title,
    status: "recording",
  });
  return id;
}

/** Resolves once `count` events of `type` have arrived on the socket. */
function countEvents(
  socket: WebSocket,
  type: string,
  count: number,
  timeoutMs = 8_000,
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let seen = 0;
  const timer = setTimeout(() => {
    socket.removeEventListener("message", onMessage);
    reject(new Error(`timed out waiting for ${count} ${type} events`));
  }, timeoutMs);
  const onMessage = (event: MessageEvent) => {
    const data = JSON.parse(String(event.data)) as Record<string, unknown>;
    if (data.type !== type) return;
    seen += 1;
    if (seen < count) return;
    clearTimeout(timer);
    socket.removeEventListener("message", onMessage);
    resolve();
  };
  socket.addEventListener("message", onMessage);
  return promise;
}

beforeAll(async () => {
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  wsUrlBase = `ws://127.0.0.1:${address.port}`;

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith("/audio/transcriptions")) return originalFetch(input, init);

    if (rateLimitResponses > 0) {
      rateLimitResponses -= 1;
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "1" },
      });
    }

    const body = init?.body;
    if (body instanceof FormData) {
      const file = body.get("file");
      if (file instanceof Blob) uploadSizes.push(file.size);
      const prompt = body.get("prompt");
      if (typeof prompt === "string") prompts.push(prompt);
    }

    return Response.json({
      text: STUB_TEXT,
      language: "english",
      segments: [
        {
          words: [
            { word: "Hello", start: 0, end: 0.5 },
            { word: "from", start: 0.5, end: 1.0 },
            { word: "the", start: 1.0, end: 1.5 },
            { word: "test", start: 1.5, end: 6.2 },
          ],
        },
      ],
    });
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
});

beforeEach(async () => {
  await resetDb();
  rateLimitResponses = 0;
  uploadSizes.length = 0;
  prompts.length = 0;
  ownerId = randomUUID();
  await db.insert(users).values({
    id: ownerId,
    email: `stream-${ownerId}@example.com`,
    firstName: "Asha",
    lastName: "Rao",
    passwordHash: "unused",
    status: "active",
    emailVerifiedAt: new Date(),
  });
  const token = await signAccessToken({ id: ownerId, tokenVersion: 0 });
  cookie = token;
});

test("streams Groq segments, sets the engine, and derives the title", async () => {
  const transcriptId = await createRecording("Recording · 21 Oct, 10:30");
  const socket = await openSocket(transcriptId);
  const ready = waitForEvent(socket, "ready");
  await ready;

  const segmentEvent = waitForEvent(socket, "segment");
  // One full window (STT_MAX_WINDOW_MS = 2000 in tests): the pass is forced and
  // the whole window commits before the user stops.
  socket.send(tone(2));
  const event = await segmentEvent;
  expect(segmentText(event)).toBe(STUB_TEXT);

  const done = waitForEvent(socket, "done");
  socket.send(JSON.stringify({ type: "stop" }));
  await done;

  const [row] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.id, transcriptId));
  expect(row?.engine).toBe("groq-whisper");
  expect(row?.title).toBe(STUB_TEXT);

  const stored = await db
    .select()
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId));
  expect(stored.map((item) => item.text)).toEqual([STUB_TEXT]);
});

test("flushes the final partial window on stop", async () => {
  const transcriptId = await createRecording("Recording · 21 Oct, 10:31");
  const socket = await openSocket(transcriptId);
  await waitForEvent(socket, "ready");

  const segmentEvent = waitForEvent(socket, "segment");
  socket.send(tone(0.8));
  socket.send(JSON.stringify({ type: "stop" }));

  const event = await segmentEvent;
  expect(segmentText(event)).toBe(STUB_TEXT);
  await waitForEvent(socket, "done");

  const stored = await db
    .select()
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId));
  expect(stored.map((item) => item.text)).toEqual([STUB_TEXT]);
});

test("clips every transcription request to the max window", async () => {
  const transcriptId = await createRecording("Recording · 21 Oct, 10:32");
  const socket = await openSocket(transcriptId);
  await waitForEvent(socket, "ready");

  // Five seconds is more than one window, so the buffer must be drained in
  // clipped windows instead of being resent whole on every pass.
  const twoSegments = countEvents(socket, "segment", 2);
  socket.send(tone(5));
  await twoSegments;

  const done = waitForEvent(socket, "done");
  socket.send(JSON.stringify({ type: "stop" }));
  await done;

  const windowBytes = 44 + 2_000 * 32; // WAV header + STT_MAX_WINDOW_MS of PCM
  expect(uploadSizes[0]).toBe(windowBytes);
  expect(uploadSizes.length).toBeGreaterThanOrEqual(2);
  for (const size of uploadSizes) expect(size).toBeLessThanOrEqual(windowBytes);
});

test("persists the final tail after a rate-limit cooldown", async () => {
  rateLimitResponses = 1;
  const transcriptId = await createRecording("Recording · 21 Oct, 10:33");
  const socket = await openSocket(transcriptId);
  await waitForEvent(socket, "ready");

  const errorEvent = waitForEvent(socket, "error");
  const segmentEvent = waitForEvent(socket, "segment", 10_000);
  const doneEvent = waitForEvent(socket, "done", 10_000);

  socket.send(tone(0.8));
  socket.send(JSON.stringify({ type: "stop" }));

  const error = await errorEvent;
  expect(String(error.message)).toContain("rate limited");

  const segment = await segmentEvent;
  expect(segmentText(segment)).toBe(STUB_TEXT);
  await doneEvent;

  const [row] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.id, transcriptId));
  expect(row?.engine).toBe("groq-whisper");
  expect(row?.title).toBe(STUB_TEXT);

  const stored = await db
    .select()
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId));
  expect(stored.map((item) => item.text)).toEqual([STUB_TEXT]);
});

test("drops a sub-200 ms tail instead of transcribing it", async () => {
  const transcriptId = await createRecording("Recording · 21 Oct, 10:34");
  const socket = await openSocket(transcriptId);
  await waitForEvent(socket, "ready");

  const done = waitForEvent(socket, "done");
  socket.send(tone(0.1));
  socket.send(JSON.stringify({ type: "stop" }));
  await done;

  expect(uploadSizes).toHaveLength(0);
  const stored = await db
    .select()
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId));
  expect(stored).toHaveLength(0);
});

test("resumes timestamps and prompt context after a reconnect", async () => {
  const transcriptId = await createRecording("Recording · 21 Oct, 10:35");
  await db
    .update(transcripts)
    .set({ createdAt: new Date(Date.now() - 10_000) })
    .where(eq(transcripts.id, transcriptId));
  await db.insert(segments).values({
    transcriptId,
    seq: 0,
    text: "Earlier words",
    startMs: 0,
    endMs: 1_000,
  });

  const socket = await openSocket(transcriptId);
  await waitForEvent(socket, "ready");

  const segmentEvent = waitForEvent(socket, "segment");
  socket.send(tone(2));
  await segmentEvent;

  const done = waitForEvent(socket, "done");
  socket.send(JSON.stringify({ type: "stop" }));
  await done;

  const stored = await db
    .select()
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId))
    .orderBy(segments.seq);
  expect(stored).toHaveLength(2);
  expect(stored[1]?.startMs).toBeGreaterThanOrEqual(9_000);
  expect(prompts.some((prompt) => prompt.includes("Earlier words"))).toBe(true);
});

test("rotates the socket before the function duration cap", async () => {
  const previous = env.WS_SESSION_MAX_MS;
  (env as { WS_SESSION_MAX_MS: number }).WS_SESSION_MAX_MS = 300;
  try {
    const transcriptId = await createRecording("Recording · 21 Oct, 10:36");
    const socket = await openSocket(transcriptId);
    await waitForEvent(socket, "ready");

    const rotated = await waitForEvent(socket, "rotate", 5_000);
    expect(rotated.type).toBe("rotate");
  } finally {
    (env as { WS_SESSION_MAX_MS: number }).WS_SESSION_MAX_MS = previous;
  }
});
