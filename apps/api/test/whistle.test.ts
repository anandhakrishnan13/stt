import { expect, test } from "bun:test";
import { transcribeWhistle } from "../src/lib/stt/whistle";
import { SttRateLimitError } from "../src/lib/stt/groq";

test("transcribeWhistle posts audio file with x-api-key and parses text", async () => {
  const originalFetch = globalThis.fetch;
  let requestedHeaderKey = "";
  let receivedAudioField = false;

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    requestedHeaderKey = headers["x-api-key"] ?? "";
    const form = init.body as FormData;
    receivedAudioField = form.has("audio");
    return Response.json({
      text: "Self deployed Whistle recognized audio",
      language: "english",
    });
  }) as unknown as typeof fetch;

  try {
    const pcm = new Uint8Array(16_000 * 2); // 1s PCM16
    const res = await transcribeWhistle(pcm);
    expect(res.text).toBe("Self deployed Whistle recognized audio");
    expect(res.words.length).toBe(5);
    expect(requestedHeaderKey).toBe("test-whistle-key");
    expect(receivedAudioField).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcribeWhistle throws SttRateLimitError on 429", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "10" },
    });
  }) as unknown as typeof fetch;

  try {
    const pcm = new Uint8Array(16_000 * 2);
    await expect(transcribeWhistle(pcm)).rejects.toBeInstanceOf(SttRateLimitError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
