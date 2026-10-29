import { describe, expect, test } from "bun:test";
import { commonPrefix, joinWords } from "../src/lib/stt/agreement";
import {
  composeSttPrompt,
  composeWhisperPrompt,
  GEMINI_STT_INSTRUCTION,
} from "../src/lib/stt/prompt";
import { cleanTranscript, pcm16Rms, pcm16ToWav, type Word } from "../src/lib/stt/audio";
import { isHallucination } from "../src/lib/stt/whisper";

function word(text: string, startMs: number, endMs: number): Word {
  return { text, startMs, endMs };
}

function pcm(samples: number[]): Uint8Array {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return new Uint8Array(buffer);
}

describe("speech helpers", () => {
  test("wraps PCM in a valid 16 kHz mono WAV header", () => {
    const pcmBytes = pcm([0, 1, -1]);
    const wav = pcm16ToWav(pcmBytes);
    expect(wav.byteLength).toBe(44 + pcmBytes.byteLength);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(36 + pcmBytes.byteLength);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(pcmBytes.byteLength);
    expect(Buffer.from(wav.slice(44))).toEqual(Buffer.from(pcmBytes));
  });

  test("silence is below the gate and a tone clears it", () => {
    expect(pcm16Rms(pcm([0, 0, 0, 0]))).toBe(0);
    const tone = pcm(Array.from({ length: 160 }, (_, i) => Math.round(Math.sin(i / 4) * 8000)));
    expect(pcm16Rms(tone)).toBeGreaterThan(1_000);
  });

  test("commits only the words two hypotheses agree on", () => {
    const left = [word("And", 0, 100), word("so", 100, 200), word("my", 200, 300)];
    const right = [word("And", 0, 100), word("so", 100, 200), word("my", 200, 300)];
    expect(commonPrefix(left, right)).toBe(3);

    const revised = [word("And", 0, 100), word("so", 100, 200), word("my", 200, 300), word("fellow", 300, 600)];
    expect(commonPrefix(left, revised)).toBe(3);
    expect(commonPrefix(left, [word("And", 0, 100), word("saw", 100, 200)])).toBe(1);
    expect(commonPrefix([], revised)).toBe(0);
  });

  test("ignores punctuation and case when comparing", () => {
    expect(commonPrefix([word("Americans,", 0, 10)], [word("americans", 0, 10)])).toBe(1);
  });

  test("joins words without spacing punctuation", () => {
    expect(joinWords([word("Hello", 0, 10), word(",", 10, 10), word(" world", 10, 20)])).toBe(
      "Hello, world",
    );
    expect(joinWords([])).toBe("");
  });

  test("drops non-speech annotations from engine output", () => {
    expect(cleanTranscript("  [BLANK_AUDIO] (music) *cough*  Namaste  ")).toBe("Namaste");
    expect(cleanTranscript("\n\n  ")).toBe("");
  });

  test("identifies Whisper silence hallucinations like Icelandic loops", () => {
    expect(isHallucination({ text: "Það er hann til því." })).toBe(true);
    expect(isHallucination({ text: "Thank you for watching." })).toBe(true);
    expect(isHallucination({ text: "Random noise", language: "icelandic" })).toBe(true);
    expect(isHallucination({ text: "ninakkenne ariyamo", language: "malayalam" })).toBe(false);
    expect(isHallucination({ text: "Hello, how are you?", language: "english" })).toBe(false);
  });
});

describe("stt prompts", () => {
  test("instructions survive prior-transcript context", () => {
    const prompt = composeSttPrompt(GEMINI_STT_INSTRUCTION, "kal mujhe meeting hai");
    expect(prompt.startsWith(GEMINI_STT_INSTRUCTION)).toBe(true);
    expect(prompt).toContain("Reference from earlier audio");
    expect(prompt).toContain("kal mujhe meeting hai");
    expect(prompt).toContain("Latin alphabet");
  });

  test("omits the context section when there is no usable context", () => {
    expect(composeSttPrompt(GEMINI_STT_INSTRUCTION)).toBe(GEMINI_STT_INSTRUCTION);
    expect(composeSttPrompt(GEMINI_STT_INSTRUCTION, "   ")).toBe(GEMINI_STT_INSTRUCTION);
  });

  test("whisper prompt joins style and speech context", () => {
    expect(composeWhisperPrompt("", "earlier words")).toBe("earlier words");
    expect(composeWhisperPrompt("hint", "earlier words")).toBe("hint earlier words");
    expect(composeWhisperPrompt("")).toBe("");
  });
});
