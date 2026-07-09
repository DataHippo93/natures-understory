// Deterministic matcher for the Produce-Orders MVP.
//
// Given a hand-written line like "Shiitake", picks the best SKU from
// public.thrive_product_catalog (Produce dept) after applying Clark's
// standing rules, computes qty (cases) from velocity + OH, and returns
// a full ready-to-insert produce_order_lines row shape.
//
// Data note: alberts_price_entries is empty in prod (0 rows) as of
// 2026-07-09, so we source the search universe from thrive_product_catalog
// which is the store's actual sellable catalog. When the Albert's pricelist
// pipeline resumes we can extend the search universe to union both.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CatalogCandidate {
  sku: string | null;
  thrive_item_id: string | null;
  thrive_variant_id: string | null;
  name: string;
  brand: string | null;
  department: string | null;
  category_path: string | null;
  default_cost_cents: number | null;
  units_per_case: number | null;
  active: boolean | null;
}

export interface MatchResult {
  matched_sku: string | null;
  matched_thrive_item_id: string | null;
  product_name: string;
  variant: string | null;
  commodity: string | null;
  qty: number;
  pack: string | null;
  units_per_case: number | null;
  unit_cost_cents: number | null;
  line_cents: number | null;
  current_oh: number | null;
  velocity_30d: number | null;
  days_of_supply: number | null;
  is_organic: boolean;
  decision: 'ORDER' | 'SKIP' | 'BID';
  reason: string;
  rule_deviation: string | null;
  features: Record<string, unknown>;
}

export interface MatchCtx {
  vendorSlug: string;
  vendorId: string | null;
  targetDos: number;
  bufferMultiplier: number;
  dayOfWeek: string;
  catalog: CatalogCandidate[];
  ohBySku: Map<string, number>;
  velBySku: Map<string, number>;
}

// ---------- text utils ----------
function tokenize(s: string): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit;
}

function isOrganic(c: CatalogCandidate): boolean {
  const hay = `${c.name} ${c.category_path ?? ''} ${c.brand ?? ''}`.toLowerCase();
  return /\borganic\b|\borg\b/.test(hay);
}

// ---------- standing rules ----------
interface RulePass {
  candidates: CatalogCandidate[];
  deviations: string[];
  forcedPick?: CatalogCandidate;
}

function applyStandingRules(rawLine: string, all: CatalogCandidate[]): RulePass {
  const line = rawLine || '';
  const deviations: string[] = [];
  let pool = all.slice();

  // 1. shiitake-lock -> force SKU 14142 (or deviate)
  if (/shiitake/i.test(line)) {
    const forced = pool.find((c) => c.sku === '14142');
    if (forced) return { candidates: [forced], deviations, forcedPick: forced };
    deviations.push('shiitake-lock: SKU 14142 not in catalog');
  }

  // 2. chicken-thighs-small-pack -> reject 67400, prefer small/retail
  if (/chicken.*thighs?|thighs?.*chicken/i.test(line)) {
    pool = pool.filter((c) => c.sku !== '67400');
    const small = pool.filter((c) => /1\s*lb|small\s*pack|retail/i.test(`${c.name} ${c.category_path ?? ''}`));
    if (small.length) pool = small;
  }

  // 3. romaine-whole-heads -> drop hearts
  if (/romaine/i.test(line)) {
    const without = pool.filter((c) => !/hearts?/i.test(c.name));
    if (without.length) pool = without;
    else deviations.push('romaine-whole-heads: only hearts available');
  }

  // 4. cilantro-local -> reject Matarazzo brand/name and pack_30
  if (/cilantro/i.test(line) && /local/i.test(line)) {
    pool = pool.filter(
      (c) =>
        !/matarazzo/i.test(c.brand ?? '') &&
        !/matarazzo/i.test(c.name) &&
        !(c.units_per_case && Number(c.units_per_case) === 30),
    );
  }

  // 5. herbs-smallest-case -> prefer smallest units_per_case
  if (/\b(parsley|dill|cilantro)\b/i.test(line)) {
    const withPack = pool.filter((c) => c.units_per_case && Number(c.units_per_case) > 0);
    if (withPack.length) {
      const min = Math.min(...withPack.map((c) => Number(c.units_per_case)));
      pool = withPack.filter((c) => Number(c.units_per_case) === min);
    }
  }

  // 6. ginger-smallest-case -> same smallest-pack heuristic
  if (/ginger/i.test(line)) {
    const withPack = pool.filter((c) => c.units_per_case && Number(c.units_per_case) > 0);
    if (withPack.length) {
      const min = Math.min(...withPack.map((c) => Number(c.units_per_case)));
      pool = withPack.filter((c) => Number(c.units_per_case) === min);
    }
  }

  // 7. organic-default -> prefer organic; note deviation if none
  const organic = pool.filter((c) => isOrganic(c));
  if (organic.length) {
    pool = organic;
  } else if (pool.length) {
    deviations.push('no organic available');
  }

  return { candidates: pool, deviations };
}

function rankCandidates(rawLine: string, pool: CatalogCandidate[]): CatalogCandidate[] {
  const needle = tokenize(rawLine);
  return pool
    .map((c) => ({ c, overlap: jaccard(needle, tokenize(c.name)), len: c.name.length }))
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.len - b.len)
    .map((s) => s.c);
}

function computeQty(opts: {
  velocityPerDay: number;
  oh: number;
  unitsPerCase: number;
  targetDos: number;
  buffer: number;
}): { cases: number; currentOhDays: number } {
  const { velocityPerDay, oh, unitsPerCase, targetDos, buffer } = opts;
  const currentOhDays = oh > 0 && velocityPerDay > 0 ? oh / velocityPerDay : 0;
  const daysToCarry = Math.max(0, targetDos - currentOhDays);
  const unitsNeeded = velocityPerDay * daysToCarry * buffer;
  const upc = unitsPerCase > 0 ? unitsPerCase : 1;
  const cases = Math.max(1, Math.ceil(unitsNeeded / upc));
  return { cases, currentOhDays };
}

export async function matchLine(rawLine: string, ctx: MatchCtx): Promise<MatchResult> {
  const line = (rawLine || '').trim();
  const rp = applyStandingRules(line, ctx.catalog);
  let picked: CatalogCandidate | null = rp.forcedPick ?? null;
  if (!picked) {
    const ranked = rankCandidates(line, rp.candidates);
    picked = ranked[0] ?? null;
  }

  if (!picked) {
    return {
      matched_sku: null,
      matched_thrive_item_id: null,
      product_name: line || '(blank)',
      variant: null,
      commodity: null,
      qty: 0,
      pack: null,
      units_per_case: null,
      unit_cost_cents: null,
      line_cents: null,
      current_oh: null,
      velocity_30d: null,
      days_of_supply: null,
      is_organic: false,
      decision: 'SKIP',
      reason: `no catalog match for "${line}"`,
      rule_deviation: rp.deviations.join('; ') || null,
      features: { ruleFiltered: rp.candidates.length, rawLine: line },
    };
  }

  const upc = picked.units_per_case ? Number(picked.units_per_case) : 1;
  const skuKey = picked.sku ?? '';
  const oh = ctx.ohBySku.get(skuKey) ?? 0;
  const vel = ctx.velBySku.get(skuKey) ?? 0;
  const { cases, currentOhDays } = computeQty({
    velocityPerDay: vel,
    oh,
    unitsPerCase: upc,
    targetDos: ctx.targetDos,
    buffer: ctx.bufferMultiplier,
  });
  const unitCost = picked.default_cost_cents ?? null;
  const lineCents = unitCost != null ? Math.round(unitCost * upc * cases) : null;

  let reason =
    `pack ${upc}u &#215; DoS ${currentOhDays.toFixed(1)}d < target ${ctx.targetDos}d &#215; ` +
    `velocity ${vel.toFixed(2)}/day &#215; ${ctx.bufferMultiplier}x buffer = ${cases} case(s)`;
  // clean up the baked-in HTML entities - we want the interpunct display
  reason = reason.replace(/&#215;/g, 'x');
  const dev = rp.deviations.length ? rp.deviations.join('; ') : null;
  if (dev) reason += ` [DEVIATION: ${dev}]`;

  return {
    matched_sku: picked.sku,
    matched_thrive_item_id: picked.thrive_item_id,
    product_name: picked.name,
    variant: picked.brand ?? null,
    commodity: null,
    qty: cases,
    pack: upc ? `${upc} ct` : null,
    units_per_case: upc,
    unit_cost_cents: unitCost,
    line_cents: lineCents,
    current_oh: oh,
    velocity_30d: vel * 30,
    days_of_supply: currentOhDays,
    is_organic: isOrganic(picked),
    decision: 'ORDER',
    reason,
    rule_deviation: dev,
    features: {
      rawLine: line,
      candidatePool: rp.candidates.length,
      forced: !!rp.forcedPick,
      dayOfWeek: ctx.dayOfWeek,
      vendorSlug: ctx.vendorSlug,
    },
  };
}

export interface BuildContextArgs {
  supabase: SupabaseClient;
  vendorSlug: string;
  vendorId: string | null;
  now?: Date;
}

export async function buildMatchContext(args: BuildContextArgs): Promise<MatchCtx> {
  const { supabase, vendorSlug, vendorId } = args;
  const now = args.now ?? new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

  // Default target DoS from spec; overridden by vendor row if set.
  let targetDos = vendorSlug === 'alberts' ? (dayOfWeek === 'Monday' ? 5.5 : 5.0) : 3.0;
  let bufferMultiplier = 1.5;

  if (vendorId) {
    const { data: v } = await supabase
      .from('produce_vendors')
      .select('target_buffer_multiplier, target_dos_overrides')
      .eq('id', vendorId)
      .maybeSingle();
    if (v) {
      if (v.target_buffer_multiplier != null) bufferMultiplier = Number(v.target_buffer_multiplier);
      const dow = dayOfWeek.slice(0, 3).toLowerCase();
      const overrides = (v.target_dos_overrides ?? {}) as Record<string, number>;
      if (overrides && typeof overrides === 'object' && dow in overrides) {
        targetDos = Number(overrides[dow]);
      }
    }
  }

  const { data: catalog } = await supabase
    .from('thrive_product_catalog')
    .select('sku, thrive_item_id, thrive_variant_id, name, brand, department, category_path, default_cost_cents, units_per_case, active')
    .eq('active', true)
    .ilike('department', '%produce%')
    .limit(5000);

  const cat = (catalog ?? []) as unknown as CatalogCandidate[];

  const ohBySku = new Map<string, number>();
  const { data: inv } = await supabase.from('thrive_inventory_latest').select('alberts_sku, qty_on_hand, thrive_item_id');
  const itemIdToSku = new Map<string, string>();
  for (const c of cat) if (c.thrive_item_id && c.sku) itemIdToSku.set(c.thrive_item_id, c.sku);
  for (const row of (inv ?? []) as Array<{ alberts_sku: string | null; qty_on_hand: number | null; thrive_item_id: string | null }>) {
    if (row.alberts_sku && row.qty_on_hand != null) ohBySku.set(row.alberts_sku, Number(row.qty_on_hand));
    if (row.thrive_item_id && row.qty_on_hand != null) {
      const sk = itemIdToSku.get(row.thrive_item_id);
      if (sk && !ohBySku.has(sk)) ohBySku.set(sk, Number(row.qty_on_hand));
    }
  }

  const since = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const velBySku = new Map<string, number>();
  const { data: sales } = await supabase
    .from('thrive_sales_history')
    .select('sku, units, sale_date')
    .gte('sale_date', since)
    .limit(20000);
  const totals = new Map<string, number>();
  for (const s of (sales ?? []) as Array<{ sku: string | null; units: number | null }>) {
    if (!s.sku) continue;
    totals.set(s.sku, (totals.get(s.sku) ?? 0) + (Number(s.units) || 0));
  }
  for (const [sk, units30] of totals) velBySku.set(sk, units30 / 30);

  return {
    vendorSlug,
    vendorId,
    targetDos,
    bufferMultiplier,
    dayOfWeek,
    catalog: cat,
    ohBySku,
    velBySku,
  };
}

export function vendorSlugToDisplayName(slug: string): string {
  switch (slug) {
    case 'alberts': return "Albert's";
    case 'kents': return "Kent's";
    case 'birdsfoot': return 'Birdsfoot';
    case 'rvfm': return 'RVFM';
    default: return slug;
  }
}
