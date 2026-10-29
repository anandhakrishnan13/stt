import { env } from "../../env";
import { transcribeGemini } from "./gemini";
import { transcribeGroq } from "./groq";
import { transcribeWhistle } from "./whistle";
import type { Transcription, Word } from "./audio";

export { SttRateLimitError } from "./groq";
export type { Transcription, Word } from "./audio";

export type SttEngine = "whisper" | "gemini" | "whistle";

export function transcribePcm(
  pcm: Uint8Array,
  context?: string,
  engine?: SttEngine | "groq",
  language?: string | null,
): Promise<Transcription> {
  const selected = engine ?? env.STT_PROVIDER;
  switch (selected) {
    case "whistle":
      return transcribeWhistle(pcm, context);
    case "gemini":
      return transcribeGemini(pcm, context);
    default:
      return transcribeGroq(pcm, context, language);
  }
}
