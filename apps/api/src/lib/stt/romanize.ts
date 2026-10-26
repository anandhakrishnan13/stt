/**
 * Practical Roman transliteration for Indic scripts.
 *
 * Whisper-class models emit Devanagari, Malayalam, Tamil, Telugu, Kannada,
 * Bengali, Gujarati, Gurmukhi, and Odia in their native scripts. The product
 * contract is chat-style Latin ("ninakkenne ariyamo", not "നിനക്കെന്നെ
 * അറിയാമോ"), so every engine's text passes through here. Long vowels collapse
 * to a single letter on purpose: speakers write "ariyamo", not "ariyaamoo".
 */

type ScriptTable = {
  from: number;
  to: number;
  viramas: number[];
  vowels: Record<number, string>;
  matras: Record<number, string>;
  consonants: Record<number, string>;
  anusvara: number[];
  candrabindu: number[];
  visarga: number[];
  noVowel: Set<number>;
  nukta: number[];
  pairs: Record<string, string>;
  digits: number | null;
  /** Bengali ং is "ng"; Tamil ஂ is "m". Otherwise the mark is contextual. */
  anusvaraRoman?: string;
  /** Hindi/Gujarati/Gurmukhi pronounce a word-final anusvara as "n". */
  wordFinalAnusvara?: string;
  /** Hindi drops the inherent "a" on a word-final consonant: कल -> kal. */
  schwaDeletion?: boolean;
};

const JOIN_CONTROLS = new Set([0x200c, 0x200d, 0xfeff]);

/** Zip character string with a space-separated roman string. */
function table(chars: string, roman: string): Record<number, string> {
  const keys = Array.from(chars);
  const values = roman.trim().split(/\s+/);
  if (keys.length !== values.length) {
    throw new Error(
      `Romanization table mismatch: ${keys.length} characters, ${values.length} values`,
    );
  }
  const map: Record<number, string> = {};
  keys.forEach((char, index) => {
    map[char.codePointAt(0) ?? 0] = values[index] ?? "";
  });
  return map;
}

function codes(...values: number[]): number[] {
  return values;
}

const DEVANAGARI: ScriptTable = {
  from: 0x0900,
  to: 0x097f,
  viramas: codes(0x94d),
  vowels: table(
    "अआइईउऊऋऌऍऎएऐऑऒओऔॠॡॲॳॴॵॶॷ",
    "a a i i u u ru lu e e e ai o o o au ru lu a o o au u u",
  ),
  matras: table(
    "ऺऻािीुूृॄॅॆेैॉॊोौॏॖॗॢॣ",
    "o o a i i u u ru ru e e e ai o o o au au u u lu lu",
  ),
  consonants: table(
    "कखगघङचछजझञटठडढणतथदधनऩपफबभमयरऱलळऴवशषसहक़ख़ग़ज़ड़ढ़फ़य़ॹॻॼॾॿ",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n n p ph b bh m y r r l l zh v sh sh s h q kh gh z r rh f y zh g j r b",
  ),
  anusvara: codes(0x902),
  candrabindu: codes(0x901),
  visarga: codes(0x903),
  noVowel: new Set(),
  nukta: codes(0x93c),
  pairs: {
    "2325,2364": "q",
    "2326,2364": "kh",
    "2327,2364": "gh",
    "2332,2364": "z",
    "2337,2364": "r",
    "2338,2364": "rh",
    "2347,2364": "f",
    "2351,2364": "y",
  },
  digits: 0x966,
  wordFinalAnusvara: "n",
  schwaDeletion: true,
};

const BENGALI: ScriptTable = {
  from: 0x0980,
  to: 0x09ff,
  viramas: codes(0x9cd),
  vowels: table("অআইঈউঊঋঌএঐওঔৠৡ", "a a i i u u ru lu e ai o au ru lu"),
  matras: table("ািীুূৃৄেৈোৌৢৣ", "a i i u u ru ru e ai o au lu lu"),
  consonants: table(
    "কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহড়ঢ়য়",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n p ph b bh m j r l sh sh s h r rh y",
  ),
  anusvara: codes(0x982),
  candrabindu: codes(0x981),
  visarga: codes(0x983),
  noVowel: new Set([0x9ce]),
  nukta: codes(0x9bc),
  pairs: { "2465,2492": "r", "2466,2492": "rh" },
  digits: 0x9e6,
  anusvaraRoman: "ng",
};

const GURMUKHI: ScriptTable = {
  from: 0x0a00,
  to: 0x0a7f,
  viramas: codes(0xa4d),
  vowels: table("ਅਆਇਈਉਊਏਐਓਔ", "a a i i u u e ai o au"),
  matras: table("ਾਿੀੁੂੇੈੋੌ", "a i i u u e ai o au"),
  consonants: table(
    "ਕਖਗਘਙਚਛਜਝਞਟਠਡਢਣਤਥਦਧਨਪਫਬਭਮਯਰਲਲ਼ਵਸ਼ਸਹਖ਼ਗ਼ਜ਼ੜਫ਼",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n p ph b bh m y r l l v sh s h kh gh z r f",
  ),
  anusvara: codes(0xa02, 0xa70),
  candrabindu: codes(0xa01),
  visarga: codes(0xa03),
  noVowel: new Set(),
  nukta: codes(0xa3c),
  pairs: {},
  digits: 0xa66,
  wordFinalAnusvara: "n",
  schwaDeletion: true,
};

const GUJARATI: ScriptTable = {
  from: 0x0a80,
  to: 0x0aff,
  viramas: codes(0xacd),
  vowels: table("અઆઇઈઉઊઋઌઍએઐઑઓઔૠૡ", "a a i i u u ru lu e e ai o o au ru lu"),
  matras: table("ાિીુૂૃૄૅેૈૉોૌૢૣ", "a i i u u ru ru e e ai o o au lu lu"),
  consonants: table(
    "કખગઘઙચછજઝઞટઠડઢણતથદધનપફબભમયરલળવશષસહૹ",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n p ph b bh m y r l l v sh sh s h zh",
  ),
  anusvara: codes(0xa82),
  candrabindu: codes(0xa81),
  visarga: codes(0xa83),
  noVowel: new Set(),
  nukta: codes(0xabc),
  pairs: {},
  digits: 0xae6,
  wordFinalAnusvara: "n",
};

const ODIA: ScriptTable = {
  from: 0x0b00,
  to: 0x0b7f,
  viramas: codes(0xb4d),
  vowels: table("ଅଆଇଈଉଊଋଌଏଐଓଔୠୡ", "a a i i u u ru lu e ai o au ru lu"),
  matras: table("ାିୀୁୂୃୄେୈୋୌୢୣ", "a i i u u ru ru e ai o au lu lu"),
  consonants: table(
    "କଖଗଘଙଚଛଜଝଞଟଠଡଢଣତଥଦଧନପଫବଭମଯରଲଳଵଶଷସହଡ଼ଢ଼ୟୱ",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n p ph b bh m y r l l v sh sh s h r rh y v",
  ),
  anusvara: codes(0xb02),
  candrabindu: codes(0xb01),
  visarga: codes(0xb03),
  noVowel: new Set(),
  nukta: codes(0xb3c),
  pairs: { "2866,2876": "r", "2867,2876": "rh" },
  digits: 0xb66,
};

const TAMIL: ScriptTable = {
  from: 0x0b80,
  to: 0x0bff,
  viramas: codes(0xbcd),
  vowels: table("அஆஇஈஉஊஎஏஐஒஓஔ", "a a i i u u e e ai o o au"),
  matras: table("ாிீுூெேைொோௌ", "a i i u u e e ai o o au"),
  consonants: table(
    "கஙசஜஞடணதநனபமயரறலளழவஶஷஸஹ",
    "k ng ch j ny t n t n n p m y r r l l zh v sh sh s h",
  ),
  anusvara: codes(0xb82),
  candrabindu: codes(0xb82),
  visarga: codes(0xb83),
  noVowel: new Set(),
  nukta: codes(),
  pairs: {},
  digits: 0xbe6,
  anusvaraRoman: "m",
};

const TELUGU: ScriptTable = {
  from: 0x0c00,
  to: 0x0c7f,
  viramas: codes(0xc4d),
  vowels: table("అఆఇఈఉఊఋఌఎఏఐఒఓఔౠౡ", "a a i i u u ru lu e e ai o o au ru lu"),
  matras: table("ాిీుూృౄెేైొోౌౢౣ", "a i i u u ru ru e e ai o o au lu lu"),
  consonants: table(
    "కఖగఘఙచఛజఝఞటఠడఢణతథదధనపఫబభమయరఱలళఴవశషసహౘౙౚ",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n p ph b bh m y r r l l zh v sh sh s h ts z r",
  ),
  anusvara: codes(0xc02, 0xc04),
  candrabindu: codes(0xc00, 0xc01),
  visarga: codes(0xc03),
  noVowel: new Set([0xc5d]),
  nukta: codes(0xc3c),
  pairs: {},
  digits: 0xc66,
};

const KANNADA: ScriptTable = {
  from: 0x0c80,
  to: 0x0cff,
  viramas: codes(0xccd),
  vowels: table("ಅಆಇಈಉಊಋಌಎಏಐಒಓಔೠೡ", "a a i i u u ru lu e e ai o o au ru lu"),
  matras: table("ಾಿೀುೂೃೄೆೇೈೊೋೌೢೣ", "a i i u u ru ru e e ai o o au lu lu"),
  consonants: table(
    "ಕಖಗಘಙಚಛಜಝಞಟಠಡಢಣತಥದಧನಪಫಬಭಮಯರಱಲಳವಶಷಸಹೞ",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n p ph b bh m y r r l l v sh sh s h f",
  ),
  anusvara: codes(0xc82, 0xcf3),
  candrabindu: codes(0xc80, 0xc81),
  visarga: codes(0xc83),
  noVowel: new Set([0xcdd]),
  nukta: codes(0xcbc),
  pairs: {},
  digits: 0xce6,
};

const MALAYALAM: ScriptTable = {
  from: 0x0d00,
  to: 0x0d7f,
  viramas: codes(0xd3b, 0xd3c, 0xd4d),
  vowels: table("അആഇഈഉഊഋഌഎഏഐഒഓഔൠൡൟ", "a a i i u u ru lu e e ai o o au ru lu i"),
  matras: table("ാിീുൂൃൄെേൈൊോൌൗൢൣ", "a i i u u ru ru e e ai o o au au lu lu"),
  consonants: table(
    "കഖഗഘങചഛജഝഞടഠഡഢണതഥദധനഩപഫബഭമയരറലളഴവശഷസഹഺൔൕൖൺൻർൽൾൿ",
    "k kh g gh ng ch chh j jh ny t th d dh n t th d dh n n p ph b bh m y r r l l zh v sh sh s h tt m y zh n n r l l k",
  ),
  anusvara: codes(0xd00, 0xd02),
  candrabindu: codes(0xd01),
  visarga: codes(0xd03),
  noVowel: new Set([
    0xd4e, 0xd54, 0xd55, 0xd56, 0xd7a, 0xd7b, 0xd7c, 0xd7d, 0xd7e, 0xd7f,
  ]),
  nukta: codes(),
  pairs: {},
  digits: 0xd66,
};

const SCRIPTS: ScriptTable[] = [
  DEVANAGARI,
  BENGALI,
  GURMUKHI,
  GUJARATI,
  ODIA,
  TAMIL,
  TELUGU,
  KANNADA,
  MALAYALAM,
];

const INDIC_RE = /[\u0900-\u0d7f]/;
const LABIALS: Record<string, true> = { p: true, ph: true, b: true, bh: true, m: true, f: true };

function scriptFor(cp: number): ScriptTable | null {
  for (const script of SCRIPTS) {
    if (cp >= script.from && cp <= script.to) return script;
  }
  return null;
}

function nextConsonant(script: ScriptTable, chars: string[], index: number): string | null {
  for (let i = index; i < chars.length; i += 1) {
    const cp = chars[i]?.codePointAt(0) ?? 0;
    if (JOIN_CONTROLS.has(cp) || script.nukta.includes(cp)) continue;
    return script.consonants[cp] ?? null;
  }
  return null;
}

function anusvaraRoman(script: ScriptTable, chars: string[], index: number): string {
  if (script.anusvaraRoman) return script.anusvaraRoman;
  const next = nextConsonant(script, chars, index + 1);
  if (!next) return script.wordFinalAnusvara ?? "m";
  return LABIALS[next] ? "m" : "n";
}

/** Converts Indic script characters to chat-style Latin; leaves other text alone. */
export function romanizeIndic(input: string): string {
  if (!INDIC_RE.test(input)) return input;

  const chars = Array.from(input);
  let out = "";
  let geminate = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    const cp = char.codePointAt(0) ?? 0;

    if (JOIN_CONTROLS.has(cp)) continue;

    // Danda and OM are shared across scripts.
    if (cp === 0x964 || cp === 0x965) {
      out += ".";
      continue;
    }
    if (cp === 0x950) {
      out += "om";
      continue;
    }

    const script = scriptFor(cp);
    if (!script) {
      out += char;
      continue;
    }

    if (script.digits !== null && cp >= script.digits && cp <= script.digits + 9) {
      out += String(cp - script.digits);
      continue;
    }

    // Gurmukhi addak doubles the next consonant: ਪੱਕਾ -> pakka.
    if (cp === 0xa71) {
      geminate = true;
      continue;
    }

    if (script.viramas.includes(cp) || script.nukta.includes(cp)) continue;

    if (script.anusvara.includes(cp)) {
      out += anusvaraRoman(script, chars, index);
      continue;
    }
    if (script.candrabindu.includes(cp)) {
      out += "n";
      continue;
    }
    if (script.visarga.includes(cp)) {
      out += "h";
      continue;
    }

    const consonant = script.consonants[cp];
    if (consonant !== undefined) {
      // A nukta can modify the consonant: ज़ is "z", not "j".
      let cursor = index + 1;
      while (cursor < chars.length && JOIN_CONTROLS.has(chars[cursor]?.codePointAt(0) ?? 0)) cursor += 1;

      let base = consonant;
      const nuktaCp = chars[cursor]?.codePointAt(0);
      if (nuktaCp !== undefined && script.nukta.includes(nuktaCp)) {
        const pair = script.pairs[`${cp},${nuktaCp}`];
        if (pair) base = pair;
        cursor += 1;
        while (cursor < chars.length && JOIN_CONTROLS.has(chars[cursor]?.codePointAt(0) ?? 0)) cursor += 1;
      }

      out += geminate ? `${base}${base}` : base;
      geminate = false;

      const followingCp = chars[cursor]?.codePointAt(0);
      if (followingCp !== undefined) {
        const matra = script.matras[followingCp];
        if (matra !== undefined) {
          out += matra;
          index = cursor;
          continue;
        }
        if (script.viramas.includes(followingCp)) {
          index = cursor;
          continue;
        }
      }

      const nextChar = chars[cursor];
      const atWordEnd =
        nextChar === undefined || !/[\p{L}\p{N}\p{M}]/u.test(nextChar);
      if (!script.noVowel.has(cp) && !(script.schwaDeletion && atWordEnd)) out += "a";
      index = cursor - 1;
      continue;
    }

    const vowel = script.vowels[cp];
    if (vowel !== undefined) {
      out += vowel;
      continue;
    }

    const matra = script.matras[cp];
    if (matra !== undefined) {
      // A matra normally follows its consonant; a stray one keeps its vowel.
      out += matra;
      continue;
    }

    // Unknown sign inside a known block: drop it rather than emit the script.
  }

  return out;
}
