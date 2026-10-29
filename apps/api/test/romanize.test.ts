import { describe, expect, test } from "bun:test";
import { romanizeIndic } from "../src/lib/stt/romanize";
import { normalizeTranscript } from "../src/lib/stt/audio";

describe("indic romanization", () => {
  test("writes Malayalam the way people type it in chat", () => {
    expect(romanizeIndic("നിനക്കെന്നെ അറിയാമോ?")).toBe("ninakkenne ariyamo?");
    expect(romanizeIndic("അവൻ ഇവിടെ ഉണ്ട്")).toBe("avan ivite unt");
    expect(romanizeIndic("ഞാൻ സ്കൂളിൽ പോകുന്നു")).toBe("nyan skulil pokunnu");
  });

  test("keeps Hindi in Hinglish, not Devanagari", () => {
    expect(romanizeIndic("कल मीटिंग है, ज़्यादा नहीं")).toBe("kal miting hai, zyada nahin");
    expect(romanizeIndic("नमस्ते, कमल कैसा है?")).toBe("namaste, kamal kaisa hai?");
    expect(romanizeIndic("मैं ठीक हूँ")).toBe("main thik hun");
  });

  test("covers Tamil, Telugu, Kannada, Bengali, Gujarati, Punjabi, and Odia", () => {
    expect(romanizeIndic("நான் ரொம்ப சந்தோஷமா இருக்கேன்")).toBe(
      "nan rompa chantoshama irukken",
    );
    expect(romanizeIndic("నేను తెలుగు మాట్లాడతాను")).toBe("nenu telugu matladatanu");
    expect(romanizeIndic("ನಾನು ಕನ್ನಡ ಕಲಿಯುತ್ತಿದ್ದೇನೆ")).toBe("nanu kannada kaliyuttiddene");
    expect(romanizeIndic("আমি বাংলা বলি")).toBe("ami bangla bali");
    expect(romanizeIndic("હું ગુજરાતી બોલું છું")).toBe("hun gujarati bolun chhun");
    expect(romanizeIndic("ਮੈਂ ਪੰਜਾਬੀ ਬੋਲਦਾ ਹਾਂ")).toBe("main panjabi bolada han");
    expect(romanizeIndic("ਪੱਕਾ")).toBe("pakka");
    expect(romanizeIndic("ମୁଁ ଓଡ଼ିଆ କହେ")).toBe("mun odia kahe");
  });

  test("leaves Latin text alone and converts only the script runs", () => {
    expect(romanizeIndic("Hello world")).toBe("Hello world");
    expect(romanizeIndic("Hello नमस्ते")).toBe("Hello namaste");
    expect(romanizeIndic("१२३ ൧൨൩")).toBe("123 123");
  });

  test("normalization drops non-speech tags before romanizing", () => {
    expect(normalizeTranscript("[BLANK_AUDIO] (music) നിനക്കെന്നെ അറിയാമോ?")).toBe(
      "ninakkenne ariyamo?",
    );
    expect(normalizeTranscript("  [...]  ")).toBe("");
  });
});
