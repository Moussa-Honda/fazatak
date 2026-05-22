/**
 * Correct Arabic Reshaper for jsPDF
 * Fixes the bug in the 'arabic-reshaper' npm package where right-joining
 * characters (alef ا, dal د, reh ر, waw و, zain ز, thal ذ) cause the
 * preceding character to render in isolated form instead of initial/medial.
 *
 * Bug: arabic-reshaper checks crep[2] (initial) & crep[3] (medial) to decide
 * if the NEXT char accepts a connection. But right-joining chars have neither
 * initial nor medial — they only have FINAL form. The correct check is
 * whether the next char has a FINAL or MEDIAL form (index 3 or 4 in our table).
 */

// [isolated, initial, medial, final]
const CHARS = new Map([
  [0x0621, [0xFE80, null,   null,   null  ]], // HAMZA
  [0x0622, [0xFE81, null,   null,   0xFE82]], // ALEF MADDA
  [0x0623, [0xFE83, null,   null,   0xFE84]], // ALEF HAMZA ABOVE
  [0x0624, [0xFE85, null,   null,   0xFE86]], // WAW HAMZA
  [0x0625, [0xFE87, null,   null,   0xFE88]], // ALEF HAMZA BELOW
  [0x0626, [0xFE89, 0xFE8B, 0xFE8C, 0xFE8A]], // YEH HAMZA
  [0x0627, [0xFE8D, null,   null,   0xFE8E]], // ALEF ← right-joining
  [0x0628, [0xFE8F, 0xFE91, 0xFE92, 0xFE90]], // BEH
  [0x0629, [0xFE93, null,   null,   0xFE94]], // TEH MARBUTA
  [0x062A, [0xFE95, 0xFE97, 0xFE98, 0xFE96]], // TEH
  [0x062B, [0xFE99, 0xFE9B, 0xFE9C, 0xFE9A]], // THEH
  [0x062C, [0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E]], // JEEM
  [0x062D, [0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2]], // HAH
  [0x062E, [0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6]], // KHAH
  [0x062F, [0xFEA9, null,   null,   0xFEAA]], // DAL ← right-joining
  [0x0630, [0xFEAB, null,   null,   0xFEAC]], // THAL ← right-joining
  [0x0631, [0xFEAD, null,   null,   0xFEAE]], // REH ← right-joining
  [0x0632, [0xFEAF, null,   null,   0xFEB0]], // ZAIN ← right-joining
  [0x0633, [0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2]], // SEEN
  [0x0634, [0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6]], // SHEEN
  [0x0635, [0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA]], // SAD
  [0x0636, [0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE]], // DAD
  [0x0637, [0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2]], // TAH
  [0x0638, [0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6]], // ZAH
  [0x0639, [0xFEC9, 0xFECB, 0xFECC, 0xFECA]], // AIN
  [0x063A, [0xFECD, 0xFECF, 0xFED0, 0xFECE]], // GHAIN
  [0x0641, [0xFED1, 0xFED3, 0xFED4, 0xFED2]], // FEH
  [0x0642, [0xFED5, 0xFED7, 0xFED8, 0xFED6]], // QAF
  [0x0643, [0xFED9, 0xFEDB, 0xFEDC, 0xFEDA]], // KAF
  [0x0644, [0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE]], // LAM
  [0x0645, [0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2]], // MEEM
  [0x0646, [0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6]], // NOON
  [0x0647, [0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA]], // HEH
  [0x0648, [0xFEED, null,   null,   0xFEEE]], // WAW ← right-joining
  [0x0649, [0xFEEF, null,   null,   0xFEF0]], // ALEF MAKSURA ← right-joining
  [0x064A, [0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2]], // YEH
  [0x067E, [0xFB56, 0xFB58, 0xFB59, 0xFB57]], // PEH
  [0x06CC, [0xFBFC, 0xFBFE, 0xFBFF, 0xFBFD]], // FARSI YEH
]);

// Lam-Alef required ligatures [isolated_ligature, final_ligature]
const LAM_ALEF = new Map([
  [0x0622, [0xFEF5, 0xFEF6]],
  [0x0623, [0xFEF7, 0xFEF8]],
  [0x0625, [0xFEF9, 0xFEFA]],
  [0x0627, [0xFEFB, 0xFEFC]],
]);

// Can this char provide a left-connection (to the char to its left in RTL writing)?
// = Has initial or medial form
const canLeft = (code) => {
  const e = CHARS.get(code);
  return e ? (e[1] !== null || e[2] !== null) : false;
};

// Can this char accept a right-connection (from the char to its right in RTL writing)?
// THE FIX: check for medial OR final (not initial/medial like the broken npm package)
const canRight = (code) => {
  const e = CHARS.get(code);
  return e ? (e[2] !== null || e[3] !== null) : false;
};

function reshapeWord(word) {
  const codes = [...word].map(c => c.codePointAt(0));
  const out   = [];

  for (let i = 0; i < codes.length; i++) {
    const code  = codes[i];
    const entry = CHARS.get(code);

    if (!entry) {
      out.push(String.fromCodePoint(code));
      continue;
    }

    // Lam + Alef ligature
    if (code === 0x0644 && i + 1 < codes.length && LAM_ALEF.has(codes[i + 1])) {
      const prevConn = i > 0 && canLeft(codes[i - 1]);
      const ligs     = LAM_ALEF.get(codes[i + 1]);
      out.push(String.fromCodePoint(prevConn ? ligs[1] : ligs[0]));
      i++;
      continue;
    }

    const prevConn = i > 0           && canLeft(codes[i - 1]);
    const nextConn = i < codes.length - 1 && canRight(codes[i + 1]);

    const [iso, ini, med, fin] = entry;

    let form;
    if      (prevConn && nextConn && med) form = med;  // medial
    else if (prevConn && fin)             form = fin;  // final (right-joining chars land here)
    else if (nextConn && ini)             form = ini;  // initial
    else                                  form = iso;  // isolated

    out.push(String.fromCodePoint(form));
  }

  return out.join('');
}

/**
 * Reshape Arabic text and convert to visual LTR order for jsPDF.
 * Steps:
 *  1. Split on spaces to process words independently.
 *  2. Reshape each Arabic word → Presentation Form codepoints.
 *  3. Reverse char order within each word (logical→visual for LTR renderer).
 *  4. Reverse word order (RTL sentence → LTR display).
 *  5. Rejoin with spaces.
 */
export function ar(text) {
  if (!text) return '';
  try {
    return String(text)
      .split(' ')
      .map(word => reshapeWord(word).split('').reverse().join(''))
      .reverse()
      .join(' ');
  } catch (_) {
    return String(text);
  }
}

export default ar;
