import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Captured = {
  model: string | null;
  responseFormat: string | null;
  temperature: string | null;
  timestampGranularity: string | null;
  fileName: string | null;
  fileType: string | null;
  wavStartsWithRiff: boolean;
};

let mode: "ok" | "rate-limit" = "ok";
const captured: Captured[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/openai/v1/audio/transcriptions") {
      return new Response("not found", { status: 404 });
    }

    if (mode === "rate-limit") {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "2" },
      });
    }

    const raw = Buffer.from(await request.arrayBuffer());
    // `request.formData()` relabels audio/wav as the audio/x-wav alias, so the
    // asserted content type comes from the raw multipart part header.
    const form = await new Response(raw, { headers: request.headers }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("missing file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const partHeader = /name="file"; filename="[^"]*"\r\nContent-Type: ([^\r\n]+)/.exec(
      raw.toString("latin1"),
    );
    captured.push({
      model: form.get("model")?.toString() ?? null,
      responseFormat: form.get("response_format")?.toString() ?? null,
      temperature: form.get("temperature")?.toString() ?? null,
      timestampGranularity: form.get("timestamp_granularities[]")?.toString() ?? null,
      fileName: file.name,
      fileType: partHeader?.[1] ?? null,
      wavStartsWithRiff:
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46,
    });

    return Response.json({
      text: "Namaste, how are you?",
      language: "hindi",
      segments: [
        {
          words: [
            { word: "Namaste,", start: 0, end: 0.4 },
            { word: "how", start: 0.4, end: 0.6 },
            { word: "are", start: 0.6, end: 0.8 },
            { word: "you?", start: 0.8, end: 1.0 },
          ],
        },
      ],
    });
  },
});

afterAll(() => server.stop(true));

const moduleUrl = pathToFileURL(resolve(import.meta.dir, "../src/lib/stt/groq.ts")).href;

function childEnv() {
  return {
    ...process.env,
    NODE_ENV: "test",
    STT_PROVIDER: "groq",
    GROQ_API_KEY: "test-groq-key",
    GROQ_BASE_URL: `http://127.0.0.1:${server.port}/openai/v1`,
    STT_GROQ_MODEL: "whisper-large-v3-turbo",
    GROQ_TIMEOUT_MS: "5000",
    STT_LANGUAGE: "",
    STT_PROMPT: "",
    JWT_SECRET: "test-jwt-secret-0123456789abcdef0123456789",
    OTP_PEPPER: "test-otp-pepper-0123456789abcdef0123456789",
  };
}

async function runChild(script: string) {
  const child = Bun.spawn({
    cmd: ["bun", "-e", script],
    cwd: resolve(import.meta.dir, ".."),
    env: childEnv(),
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
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

test("transcribes PCM through Groq with word timestamps", async () => {
  mode = "ok";
  captured.length = 0;

  const result = await runChild(`
    import { transcribeGroq } from ${JSON.stringify(moduleUrl)};
    const pcm = new Uint8Array(16000 * 2);
    const transcription = await transcribeGroq(pcm);
    console.log(JSON.stringify(transcription));
  `);

  expect(result.text).toBe("Namaste, how are you?");
  expect(result.language).toBe("hindi");
  expect(result.words).toHaveLength(4);

  const request = captured[0];
  expect(request?.model).toBe("whisper-large-v3-turbo");
  expect(request?.responseFormat).toBe("verbose_json");
  expect(request?.temperature).toBe("0");
  expect(request?.timestampGranularity).toBe("word");
  expect(request?.fileName).toBe("window.wav");
  // Read from the raw multipart part header: `request.formData()` reports the
  // registered alias audio/x-wav even though the part is serialized as audio/wav.
  expect(request?.fileType).toBe("audio/wav");
  expect(request?.wavStartsWithRiff).toBe(true);
});

test("raises a typed rate-limit error with the retry delay", async () => {
  mode = "rate-limit";

  const result = await runChild(`
    import { transcribeGroq } from ${JSON.stringify(moduleUrl)};
    try {
      await transcribeGroq(new Uint8Array(16000 * 2));
      console.log(JSON.stringify({ name: "none" }));
    } catch (error) {
      console.log(JSON.stringify({ name: error.name, retryAfterMs: error.retryAfterMs }));
    }
  `);

  expect(result.name).toBe("SttRateLimitError");
  expect(result.retryAfterMs).toBe(2000);
});
