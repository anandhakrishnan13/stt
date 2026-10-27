import { expect, test } from "bun:test";
import { transcribeGemini } from "../src/lib/stt/gemini";
import { SttRateLimitError } from "../src/lib/stt/groq";

type InlineDataPart = { inlineData?: { mimeType: string; data: string } };
type GeminiRequestBody = {
  contents: Array<{
    parts: Array<InlineDataPart>;
  }>;
};

test("transcribeGemini sends base64 WAV inlineData and parses response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody: GeminiRequestBody | null = null;
  const getBody = (): GeminiRequestBody => {
    if (!requestedBody) throw new Error("no body captured");
    return requestedBody;
  };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requestedUrl = url;
    requestedBody = JSON.parse(String(init.body)) as GeminiRequestBody;
    return Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: "Hello this is a test from Gemini" }],
          },
        },
      ],
    });
  }) as unknown as typeof fetch;

  try {
    const pcm = new Uint8Array(16_000 * 2); // 1 sec of PCM16
    const res = await transcribeGemini(pcm);
    expect(res.text).toBe("Hello this is a test from Gemini");
    expect(res.words.length).toBe(7);
    expect(requestedUrl).toContain("gemini-2.5-flash");
    const body = getBody();
    const firstPart = body.contents[0]?.parts[0];
    expect(firstPart?.inlineData?.data).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcribeGemini fails over to next key on 429", async () => {
  const originalFetch = globalThis.fetch;
  const attemptedKeys: string[] = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const key = headers?.["x-goog-api-key"] ?? new URL(url).searchParams.get("key") ?? "";
    attemptedKeys.push(key);
    if (attemptedKeys.length === 1) {
      return new Response("rate limited", { status: 429, headers: { "retry-after": "5" } });
    }
    return Response.json({
      candidates: [{ content: { parts: [{ text: "Success on failover" }] } }],
    });
  }) as unknown as typeof fetch;

  try {
    const pcm = new Uint8Array(16_000 * 2);
    const res = await transcribeGemini(pcm);
    expect(res.text).toBe("Success on failover");
    expect(attemptedKeys.length).toBe(2);
    expect(attemptedKeys[0]).not.toBe(attemptedKeys[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcribeGemini throws SttRateLimitError when all keys are throttled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "5" },
    });
  }) as unknown as typeof fetch;

  try {
    const pcm = new Uint8Array(16_000 * 2);
    await expect(transcribeGemini(pcm)).rejects.toBeInstanceOf(SttRateLimitError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcribeGemini forwards custom mimeType inlineData", async () => {
  const originalFetch = globalThis.fetch;
  let capturedMime = "";
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      contents: Array<{ parts: Array<{ inlineData?: { mimeType: string } }> }>;
    };
    capturedMime = body.contents[0]?.parts[0]?.inlineData?.mimeType ?? "";
    return Response.json({
      candidates: [{ content: { parts: [{ text: "Webm upload test" }] } }],
    });
  }) as unknown as typeof fetch;

  try {
    const fakeWebm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    const res = await transcribeGemini(fakeWebm, undefined, "audio/webm");
    expect(res.text).toBe("Webm upload test");
    expect(capturedMime).toBe("audio/webm");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
