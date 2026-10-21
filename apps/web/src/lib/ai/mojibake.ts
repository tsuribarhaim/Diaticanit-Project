// TCK-159: the model sometimes starts a Hebrew reply with mojibake - Hebrew
// encoded as UTF-8 and then read as Windows-1252 - e.g. "×‘×•×§×¨" instead of
// "בוקר". Every Hebrew letter is UTF-8 byte 0xD7 (shown as "×") followed by a
// second byte 0x90-0xAA, so the pair can be mapped back deterministically.
// Our own decoding is correct; this only repairs what the model produced.

const LEAD_CHAR = "×";

// cp1252 characters whose byte falls in the Hebrew letter range 0x90-0xAA.
const CP1252_TO_BYTE: Record<string, number> = {
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  "š": 0x9a,
  "›": 0x9b,
  "œ": 0x9c,
  "ž": 0x9e,
  "Ÿ": 0x9f,
};

function hebrewLetterFor(second: string): string | null {
  const codePoint = second.codePointAt(0) ?? 0;
  const byte = codePoint >= 0x80 && codePoint <= 0xbf ? codePoint : CP1252_TO_BYTE[second];
  if (byte === undefined || byte < 0x90 || byte > 0xaa) return null;
  return String.fromCharCode(0x05c0 + (byte & 0x3f));
}

export function repairHebrewMojibake(text: string): string {
  if (!text.includes(LEAD_CHAR)) return text;
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === LEAD_CHAR && i + 1 < text.length) {
      const letter = hebrewLetterFor(text[i + 1]);
      if (letter) {
        result += letter;
        i++;
        continue;
      }
    }
    result += char;
  }
  return result;
}

// Streaming tokens can split a "×" pair across two chunks, so a trailing "×"
// is held back until the next chunk (or flush) decides what it was.
export function createMojibakeStreamRepairer(): { push(text: string): string; flush(): string } {
  let carry = "";
  return {
    push(text: string) {
      const joined = carry + text;
      if (joined.endsWith(LEAD_CHAR)) {
        carry = LEAD_CHAR;
        return repairHebrewMojibake(joined.slice(0, -1));
      }
      carry = "";
      return repairHebrewMojibake(joined);
    },
    flush() {
      const tail = carry;
      carry = "";
      return tail;
    },
  };
}
