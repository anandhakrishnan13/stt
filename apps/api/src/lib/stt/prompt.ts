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
  "Transcribe the audio verbatim in the language that was spoken.",
  "Never translate: Malayalam speech stays Malayalam, Hindi stays Hindi, Tamil stays Tamil, and English stays English.",
  "Write every non-Latin script in Latin letters the way people type in chat (such as Manglish, Hinglish, Tanglish). Never output native script characters such as Devanagari, Malayalam, Tamil, Telugu, Kannada, Bengali, Gujarati, Gurmukhi, or Odia.",
  "Transcribe only speech you can actually hear. If there is silence, noise, or music, output an empty transcript. Never invent words, continue the previous transcript, or answer a question.",
  "Do not add commentary, speaker labels, or explanations. Output only the transcript.",
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
