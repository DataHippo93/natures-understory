// Cheap heuristic parser for a handwritten-list line.
//
// Splits patterns like:
//   "3 shiitake bulk case @ 24.50"      -> { qty:3, name:"shiitake bulk case", unit_cost:24.50 }
//   "2 cs cilantro (30ct)"              -> { qty:2, name:"cilantro (30ct)" }
//   "romaine 6"                         -> { qty:6, name:"romaine" }  (trailing number)
//   "shiitake"                          -> { qty:1, name:"shiitake" }
//
// It's intentionally forgiving — the review page is the authoritative
// editor. Everything after the "@ $X.XX" or "$X.XX" becomes unit cost.

export interface ParsedLine {
  qty: number;
  name: string;
  unit_cost_cents: number | null;
  pack: string | null;
  raw: string;
}

const NUM = /^(\d+(?:\.\d+)?)\b\s*/;
const TRAILING_NUM = /\s+(\d+(?:\.\d+)?)$/;
const PRICE = /\s*[@]?\s*\$?(\d+(?:\.\d{1,2})?)\s*$/;
const PACK = /\((\d+\s?(?:ct|lb|oz|#|cs)?[^)]*)\)/i;

export function parseRawLine(input: string): ParsedLine {
  const raw = input.trim();
  if (!raw) return { qty: 0, name: '', unit_cost_cents: null, pack: null, raw };

  let s = raw;

  // Pull price off the end.
  let unit_cost_cents: number | null = null;
  const pmatch = s.match(PRICE);
  if (pmatch) {
    unit_cost_cents = Math.round(Number(pmatch[1]) * 100);
    s = s.slice(0, pmatch.index!).trim();
  }

  // Pull pack description from parens.
  let pack: string | null = null;
  const packMatch = s.match(PACK);
  if (packMatch) {
    pack = packMatch[1].trim();
    // keep pack in the name — it's often part of the item id
  }

  // Leading qty.
  let qty = 1;
  const leading = s.match(NUM);
  if (leading) {
    qty = Number(leading[1]);
    s = s.slice(leading[0].length).trim();
    // Strip "cs" or "case" or "cases" that often follows the qty.
    s = s.replace(/^(cases?|cs|ea|lb|lbs|bunches?|bunch|hds?|heads?|bags?)\s+/i, '').trim();
  } else {
    const trailing = s.match(TRAILING_NUM);
    if (trailing) {
      qty = Number(trailing[1]);
      s = s.slice(0, trailing.index!).trim();
    }
  }

  return { qty, name: s, unit_cost_cents, pack, raw };
}

export function parseRawText(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map(parseRawLine);
}
