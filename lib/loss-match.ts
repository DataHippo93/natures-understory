// Loss-ledger → Thrive item fuzzy matcher.
//
// Builds a Map<thrive_item_id, loss_units_30d> from the loss_ledger
// table joined to thrive_product_catalog by normalized-name token
// overlap. Used to subtract loss volume from raw sales velocity (so
// the suggested-order math doesn't reorder items that are actually
// just spoiling).

import { createAdminClient } from './supabase/admin';

/** Words that carry no matching signal — strip before tokenizing. */
const STOP_WORDS = new Set([
  'organic', 'org', 'fresh', 'conventional', 'conv', 'local',
  'lb', 'lbs', 'each', 'ea', 'ct', 'pk', 'pack', 'case',
  'and', 'or', 'with', 'of', 'the', 'a', 'an',
  'sm', 'small', 'lg', 'large', 'med', 'medium',
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
  );
}

interface CatalogRow {
  thrive_item_id: string;
  name: string;
}
interface LossAgg {
  item_name: string;
  loss_units_30d: number;
}

/**
 * For each Thrive item id, return the matched loss units in the last 30d.
 * Multiple loss-ledger rows can map to the same Thrive item; we sum them.
 * One loss row matching multiple Thrive items: distribute equally (or
 * accept the over-count for v1; conservative direction).
 */
export async function loadLossByItem30d(
  catalog: CatalogRow[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (catalog.length === 0) return result;

  const admin = createAdminClient();
  if (!admin) return result;

  // Pull all produce-flagged loss rows from the last 30 days
  const { data, error } = await admin
    .from('loss_ledger')
    .select('item_name, quantity, pulled_date')
    .eq('is_produce', true)
    .gte('pulled_date', new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));

  if (error || !data) return result;

  // Aggregate loss rows by item_name (case-insensitive)
  const lossByName = new Map<string, number>();
  for (const row of data as Array<{ item_name: string | null; quantity: number | string | null }>) {
    if (!row.item_name) continue;
    const key = row.item_name.toLowerCase().trim();
    lossByName.set(key, (lossByName.get(key) ?? 0) + Number(row.quantity ?? 0));
  }

  // Precompute Thrive item tokens
  const itemTokens = catalog.map((c) => ({ id: c.thrive_item_id, name: c.name, tokens: tokenize(c.name) }));

  // For each loss-name aggregate, find matching Thrive items
  for (const [lossName, lossUnits] of lossByName) {
    const lossTokens = tokenize(lossName);
    if (lossTokens.size === 0) continue;
    const matches: typeof itemTokens = [];
    for (const it of itemTokens) {
      let overlap = 0;
      for (const t of lossTokens) if (it.tokens.has(t)) overlap++;
      if (overlap > 0) matches.push(it);
    }
    if (matches.length === 0) continue;
    const share = lossUnits / matches.length;
    for (const m of matches) {
      result.set(m.id, (result.get(m.id) ?? 0) + share);
    }
  }

  return result;
}

export { tokenize };
