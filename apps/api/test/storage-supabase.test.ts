import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BUCKET = "transcripts";
const KEY = "audio/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.webm";
const PAYLOAD = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

type Captured = { method: string; path: string; headers: Headers; body: Uint8Array | null };

const stored = new Map<string, Uint8Array>();
const captured: Captured[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body =
      request.method === "POST" ? new Uint8Array(await request.arrayBuffer()) : null;
    captured.push({ method: request.method, path: url.pathname, headers: request.headers, body });

    const prefix = `/storage/v1/object/${BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return new Response("not found", { status: 404 });
    const key = url.pathname.slice(prefix.length);

    if (request.method === "POST") {
      stored.set(key, body ?? new Uint8Array());
      return Response.json({ Key: key });
    }

    const bytes = stored.get(key);
    if (!bytes) return new Response("missing", { status: 404 });

    if (request.method === "DELETE") {
      stored.delete(key);
      return Response.json({ message: "removed" });
    }

    const range = request.headers.get("range");
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) },
      });
    }

    if (!range) {
      return new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength), "accept-ranges": "bytes" },
      });
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(match?.[1] ?? 0);
    const end = Number(match?.[2] ?? bytes.byteLength - 1);
    const slice = bytes.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        "content-length": String(slice.byteLength),
        "content-range": `bytes ${start}-${end}/${bytes.byteLength}`,
      },
    });
  },
});

afterAll(() => server.stop(true));

test("talks to Supabase Storage over its REST API", async () => {
  const moduleUrl = pathToFileURL(resolve(import.meta.dir, "../src/lib/storage.ts")).href;
  const script = `
    import { getStorage } from ${JSON.stringify(moduleUrl)};
    const storage = getStorage();
    const key = ${JSON.stringify(KEY)};
    await storage.put({ key, contentType: "audio/webm", bytes: new Uint8Array(${JSON.stringify([...PAYLOAD])}) });
    const size = await storage.size(key);
    const whole = await storage.read(key);
    const wholeBytes = [];
    for await (const chunk of whole.body) wholeBytes.push(...chunk);
    const ranged = await storage.read(key, { start: 2, end: 5 });
    const rangedBytes = [];
    for await (const chunk of ranged.body) rangedBytes.push(...chunk);
    await storage.remove(key);
    console.log(JSON.stringify({
      name: storage.name,
      size,
      status: whole.status,
      wholeBytes,
      rangedStatus: ranged.status,
      rangedHeaders: ranged.headers,
      rangedBytes,
      afterRemove: await storage.size(key),
    }));
  `;

  const child = Bun.spawn({
    cmd: ["bun", "-e", script],
    cwd: resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      STORAGE_DRIVER: "supabase",
      SUPABASE_URL: `http://127.0.0.1:${server.port}`,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      SUPABASE_BUCKET: BUCKET,
      JWT_SECRET: "test-jwt-secret-0123456789abcdef0123456789",
      OTP_PEPPER: "test-otp-pepper-0123456789abcdef0123456789",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
  expect(result.name).toBe("supabase");
  expect(result.size).toBe(PAYLOAD.byteLength);
  expect(result.status).toBe(200);
  expect(result.wholeBytes).toEqual([...PAYLOAD]);
  expect(result.rangedStatus).toBe(206);
  expect(result.rangedHeaders).toMatchObject({
    "content-range": "bytes 2-5/8",
    "content-length": "4",
  });
  expect(result.rangedBytes).toEqual([2, 3, 4, 5]);
  expect(result.afterRemove).toBeNull();

  const upload = captured.find((entry) => entry.method === "POST");
  expect(upload?.path).toBe(`/storage/v1/object/${BUCKET}/${KEY}`);
  expect(upload?.headers.get("authorization")).toBe("Bearer service-role-key");
  expect(upload?.headers.get("x-upsert")).toBe("true");
  expect(upload?.headers.get("content-type")).toBe("audio/webm");

  const ranged = captured.find((entry) => entry.headers.get("range") === "bytes=2-5");
  expect(ranged?.method).toBe("GET");
  expect(captured.some((entry) => entry.method === "DELETE")).toBe(true);
});
