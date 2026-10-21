import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { segments, transcripts, users } from "../src/db/schema";
import { ACCESS_COOKIE } from "../src/lib/cookies";
import { signAccessToken } from "../src/lib/tokens";
import { resetDb } from "./db";

let app: FastifyInstance;
let wsUrlBase: string;
let ownerId: string;
let cookie: string;
const originalFetch = globalThis.fetch;

const STUB_TEXT = "Hello from the test";

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
  socket.send(tone(6.2));
  const event = await segmentEvent;
  expect((event.segment as { text: string }).text).toBe(STUB_TEXT);

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
  expect((event.segment as { text: string }).text).toBe(STUB_TEXT);
  await waitForEvent(socket, "done");

  const stored = await db
    .select()
    .from(segments)
    .where(eq(segments.transcriptId, transcriptId));
  expect(stored.map((item) => item.text)).toEqual([STUB_TEXT]);
});
