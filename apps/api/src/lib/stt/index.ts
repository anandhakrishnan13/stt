import { env } from "../../env";
import { transcribeGemini } from "./gemini";
import { transcribeGroq } from "./groq";
import { transcribeWhistle } from "./whistle";
import type { Transcription, Word } from "./whisper";

export { SttRateLimitError } from "./groq";
export type { Transcription, Word } from "./whisper";

export type SttEngine = "whisper" | "gemini" | "whistle";

export function transcribePcm(
  pcm: Uint8Array,
  context?: string,
  engine?: SttEngine | "groq",
): Promise<Transcription> {
  const selected = engine ?? env.STT_PROVIDER;
  if (selected === "whistle") return transcribeWhistle(pcm, context);
  if (selected === "gemini") return transcribeGemini(pcm, context);
  return transcribeGroq(pcm, context);
}
