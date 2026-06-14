// Parser for the operator notes textarea on /orders/next-produce.
//
// Grammar (one action per line, case-insensitive):
//   add [N] [cs|case|cases|ea|each] <item>
//   skip <item>
//   s/o <customer> [N] [cs|case|cases] <item>
//   note <item>: <free text>
//   <free text>                         → unparsed; surfaced as a noop
//
// Items are fuzzy-matched against a list of Thrive product names
// passed in. First sufficient-overlap match wins.

import { tokenize } from './loss-match';

export type ParsedAction =
  | { kind: 'add'; qty: number; unit: 'cases' | 'units'; itemId: string; itemName: string; matchedFrom: string }
  | { kind: 'skip'; itemId: string; itemName: string; matchedFrom: string }
  | { kind: 'so'; customer: string; qty: number; unit: 'cases' | 'units'; itemId: string; itemName: string; matchedFrom: string }
  | { kind: 'note'; itemId: string; itemName: string; text: string; matchedFrom: string }
  | { kind: 'noop'; raw: string; reason: string };

export interface Catalog { thrive_item_id: string; name: string }

function findItem(needle: string, catalog: Catalog[]): { itemId: string; itemName: string } | null {
  const needleTokens = tokenize(needle);
  if (needleTokens.size === 0) return null;
  let best: { c: Catalog; overlap: number } | null = null;
  for (const c of catalog) {
    const tk = tokenize(c.name);
    let overlap = 0;
    for (const t of needleTokens) if (tk.has(t)) overlap++;
    if (overlap === 0) continue;
    if (!best || overlap > best.overlap) best = { c, overlap };
  }
  if (!best) return null;
  return { itemId: best.c.thrive_item_id, itemName: best.c.name };
}

function parseQty(s: string | undefined): { qty: number; unit: 'cases' | 'units'; rest: string } {
  if (!s) return { qty: 1, unit: 'units', rest: '' };
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(cs|case|cases|ea|each)?\s*(.*)$/i);
  if (!m) return { qty: 1, unit: 'units', rest: s.trim() };
  const qty = parseFloat(m[1]);
  const unitToken = (m[2] ?? '').toLowerCase();
  const unit = (unitToken.startsWith('cs') || unitToken.startsWith('case')) ? 'cases' : 'units';
  return { qty, unit, rest: m[3] ?? '' };
}

export function parseNotes(notes: string, catalog: Catalog[]): ParsedAction[] {
  if (!notes || !notes.trim()) return [];
  const actions: ParsedAction[] = [];
  const lines = notes.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();

    // skip <item>
    let m = lower.match(/^(?:skip|drop|don'?t order|no)\s+(.+)$/);
    if (m) {
      const found = findItem(m[1], catalog);
      if (found) actions.push({ kind: 'skip', ...found, matchedFrom: line });
      else actions.push({ kind: 'noop', raw: line, reason: `couldn't match "${m[1]}" to a Produce SKU` });
      continue;
    }

    // s/o <customer> [N] item
    m = lower.match(/^s\/o\s+([a-z][\w'.-]*(?:\s+[a-z][\w'.-]*)?)\s+(.+)$/i);
    if (m) {
      const customer = m[1];
      const { qty, unit, rest } = parseQty(m[2]);
      const found = findItem(rest || m[2], catalog);
      if (found) actions.push({ kind: 'so', customer, qty, unit, ...found, matchedFrom: line });
      else actions.push({ kind: 'noop', raw: line, reason: `S/O for ${customer}: couldn't match "${rest || m[2]}"` });
      continue;
    }

    // note <item>: text
    m = line.match(/^note\s+([^:]+):\s*(.+)$/i);
    if (m) {
      const found = findItem(m[1], catalog);
      if (found) actions.push({ kind: 'note', text: m[2], ...found, matchedFrom: line });
      else actions.push({ kind: 'noop', raw: line, reason: `note: couldn't match "${m[1]}"` });
      continue;
    }

    // add [N] item
    m = lower.match(/^add\s+(.+)$/);
    if (m) {
      const { qty, unit, rest } = parseQty(m[1]);
      const found = findItem(rest || m[1], catalog);
      if (found) actions.push({ kind: 'add', qty, unit, ...found, matchedFrom: line });
      else actions.push({ kind: 'noop', raw: line, reason: `couldn't match "${rest || m[1]}" to a Produce SKU` });
      continue;
    }

    // bare line "2 cs asparagus" — try add-like parse
    m = lower.match(/^(\d+(?:\.\d+)?\s*(?:cs|case|cases|ea|each)?\s*.+)$/);
    if (m) {
      const { qty, unit, rest } = parseQty(m[1]);
      if (qty && rest) {
        const found = findItem(rest, catalog);
        if (found) {
          actions.push({ kind: 'add', qty, unit, ...found, matchedFrom: line });
          continue;
        }
      }
    }

    actions.push({ kind: 'noop', raw: line, reason: 'unrecognized — try: add N item / skip item / s/o customer N item / note item: text' });
  }

  return actions;
}
