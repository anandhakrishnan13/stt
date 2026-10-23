import { env, geminiApiKeys } from "../../env";
import { SttRateLimitError } from "./groq";
import { composeSttPrompt, GEMINI_STT_INSTRUCTION } from "./prompt";
import {
  cleanTranscript,
  extractWords,
  pcm16ToWav,
  SAMPLE_RATE,
  type Transcription,
} from "./whisper";

let currentKeyIndex = 0;

export async function transcribeGemini(
  pcm: Uint8Array,
  context?: string,
): Promise<Transcription> {
  const keys = geminiApiKeys();
  if (keys.length === 0) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const wav = pcm16ToWav(pcm);
  const base64Audio = Buffer.from(wav).toString("base64");
  const effectivePrompt = composeSttPrompt(GEMINI_STT_INSTRUCTION, context);

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: base64Audio,
            },
          },
          {
            text: effectivePrompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  });

  // Round-robin rotation across provided keys, with failover if a key is rate-limited
  const startIndex = Math.abs(currentKeyIndex++) % keys.length;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[(startIndex + attempt) % keys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.STT_GEMINI_MODEL}:generateContent?key=${key}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
      });

      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        const retryAfterMs =
          Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
        lastError = new SttRateLimitError(retryAfterMs);
        // Try the next key in the pool
        continue;
      }

      if (!response.ok) {
        throw new Error(`Gemini returned ${response.status}`);
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const text = cleanTranscript(rawText);
      const durationMs = (pcm.byteLength / 2 / SAMPLE_RATE) * 1000;

      return {
        text,
        language: "auto",
        words: extractWords({}, text, durationMs),
      };
    } catch (err) {
      if (err instanceof SttRateLimitError) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("All Gemini API keys failed");
}
