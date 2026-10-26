/**
 * Speech-to-text prompts.
 *
 * Gemini reads the text part as instructions, so it gets explicit language and
 * script rules plus few-shot examples. Whisper treats its prompt as prior text
 * rather than as a command, so it gets no transcript context: feeding the
 * previous segment back makes Whisper continue that text and invent sentences
 * on short windows. Script normalization happens after every engine in
 * `normalizeTranscript`, so Whisper does not need a style prompt at all.
 */

export const GEMINI_STT_INSTRUCTION = [
  "You are a speech-to-text transcriber.",
  "CORE TASK: Convert spoken audio directly into written text. DO NOT TRANSLATE. Never translate the speaker's words into another language.",
  "SEMANTICS & EXPRESSION: Use appropriate semantics, capitalization, and punctuation (such as commas, question marks, and exclamation marks) to accurately capture the speaker's expression, emphasis, and tone.",
  "SCRIPT RULE: Always write in English letters (Latin alphabet). If the speaker speaks English, write in natural English. If the speaker speaks Malayalam, Hindi, Tamil, or another language, transcribe their exact spoken words phonetically in English letters (Latin alphabet / chat style). Never output native script characters.",
  "SILENCE & NOISE: If the audio is silence, background noise, breathing, or music, output an empty transcript. Never invent or hallucinate sentences.",
  "FORMAT: Output strictly the transcript text. No quotation marks, no preamble, and no commentary.",
].join(" ");

export function composeSttPrompt(instruction: string, context?: string): string {
  const base = instruction.trim();
  const prior = context?.trim();
  if (!prior) return base;
  return `${base}\n\nReference from earlier audio (same language, do not repeat or translate):\n${prior}`;
}

/** Optional prior-text hint for Whisper. Style is empty by default; context carries recent words. */
export function composeWhisperPrompt(style?: string, context?: string): string {
  return [style?.trim(), context?.trim()].filter(Boolean).join(" ");
}
