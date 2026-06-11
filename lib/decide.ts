// Deterministic order-build logic. Takes a normalized order list (the
// Cowork agent OCRs and cleans handwritten input, then POSTs structured
// JSON), returns Decisions ready to write to alberts_order_lines.
//
// TS twin of pipeline/decide.py + pipeline/run.py from
// natures-produce-buying.

import { newDecision, supplierNoteText, internalPoText, type Decision } from '@/lib/audience';

export interface OrderInput {
  /** YYYY-MM-DD — the order's calendar day in store-local time. */
  order_date: string;
  /** YYYY-MM-DD — which pricelist date to match against (usually = order_date). */
  ref_pricelist_date: string;
  /** True for testing/rehearsal runs (no email send, no PO write). */
  rehearsal?: boolean;
  lines: OrderLineInput[];
}

export interface OrderLineInput {
  /** Verbatim text from the handwritten list */
  raw_text: string;
  /** Normalized name to match against pricelist (e.g. "scallions"). */
  name: string;
  /** Number of cases requested (default 1) */
  qty?: number;
  /** Optional pinned SKU — the matcher uses this verbatim, no fuzzy match */
  pinned_sku?: string;
  /** Notes that came inline with the handwritten line */
  notes?: string;
  /** S/O metadata if this line is a special order */
  so_customer?: string;
  so_phone?: string;
}

export interface PricelistEntry {
  sku: string;
  product_desc: string;
  size: string;
  prod_type: string;     // '' = organic
  shipper_code: string;
  price: number | null;
  pack: number | null;
  pkg_size: string;
  availability: string;
  origin: string;
}

export interface FeatureBundle {
  price_stats?: { current: number; avg90: number | null; pct_vs_avg: number | null; n: number };
  sales_velocity?: { units_per_week: number | null; insufficient: boolean };
  seasonal_index?: { value: number | null; insufficient: boolean };
  elasticity_hint?: { value: number | null; insufficient: boolean };
  inventory?: { qty_on_hand: number | null; confidence: number; hours_since_count: number | null };
}

export interface BuildResult {
  decisions: Decision[];
  subtotal_cents: number;
  subtotal_if_bids_cents: number;
  open_questions: string[];
  availability_flags: string[];
  conv_unavoidable: string[];
  added_per_clark: string[];
  dropped: string[];
  /** PRODUCE lines about to ship as conventional with no organic alternative and no local hint. Surface to Clark before send. Per memory `feedback_no_silent_conventional.md` (2026-05-03 produce-only scope). Non-produce conv lines are NOT in this bucket. */
  conv_produce_for_review: Array<{
    sku: string;
    description: string;
    reason: string;
  }>;
  /** PRODUCE lines where Albert's has no organic but a local supplier likely covers it — Clark should consider sourcing local instead. */
  local_alt_recommended: Array<{
    sku: string;
    description: string;
    local_supplier: string;
  }>;
}

const ORGANIC_PROD_TYPES = new Set(['', 'O2']); // '' = certified organic, O2 = 95% organic
const BID_THRESHOLD_PCT = 30;   // bid when current ≥ 30% above 90d avg
const BID_MAX_LINES = 2;        // keep credibility — never more than 2 bids/run

/**
 * Produce classifier (per Clark, 2026-05-03 — see memory
 * `feedback_no_silent_conventional.md`). The conv-flag rule applies ONLY
 * to produce-department lines. Fresh non-produce (dairy, deli, prepared)
 * can ship conv without surfacing.
 *
 * Albert's pricelist convention: produce items have descriptions starting
 * with the produce noun ("Cilantro", "Cucumbers", "Tomatoes (Regular)",
 * "Berries, Strawberries, Driscoll", "Salads, Baby Arugula"). Non-produce
 * items start with the category ("Yogurt, Greek...", "Butter, Unsalted...",
 * "Hummus, Lemon Garlic...", "Poultry, Chicken Thigh...").
 */
const PRODUCE_PRIMARY_NOUNS = new Set([
  'apples', 'asparagus', 'avocados', 'bananas', 'beans', 'beets', 'berries',
  'blueberries', 'bok choy', 'broccoli', 'brussels sprouts', 'cabbage', 'carrots',
  'cauliflower', 'celery', 'cherries', 'chiles', 'cilantro', 'corn', 'cucumbers',
  'daikon', 'dates', 'dill', 'eggplant', 'fennel', 'figs', 'garlic', 'ginger',
  'grapefruit', 'grapes', 'greens', 'guavas', 'herbs', 'jicama', 'kale',
  'kohlrabi', 'kiwi', 'kiwifruit', 'leeks', 'lemons', 'lettuce', 'limes',
  'mandarins', 'mangos', 'melons', 'microgreens', 'mint', 'mushrooms',
  'nectarines', 'okra', 'onions', 'oranges', 'papaya', 'parsley', 'parsnips',
  'pears', 'peas', 'peppers', 'persimmons', 'pineapples', 'plums', 'pomegranates',
  'potatoes', 'pumpkin', 'quinces', 'radishes', 'raspberries', 'rhubarb',
  'rutabaga', 'salads', 'scallions', 'shallots', 'spinach', 'sprouts', 'squash',
  'strawberries', 'sweet potato', 'sweet potatoes', 'tangerines', 'tomatillos',
  'tomatoes', 'turnips', 'watermelon', 'yams', 'zucchini',
]);

/**
 * Returns true iff the picked SKU is a produce-department item per Albert's
 * description convention. The conv-flag rule fires only when this is true.
 */
export function isProduceCategory(picked: PricelistEntry): boolean {
  const primary = (picked.product_desc.split(/[,(]/, 1)[0] ?? '').trim().toLowerCase();
  return PRODUCE_PRIMARY_NOUNS.has(primary);
}

/**
 * Local supplier coverage hint — per Clark's seasonal memory.
 * When an organic Albert's variant doesn't exist for a produce line AND a
 * local supplier carries the item in-season, recommend sourcing locally
 * (drop the line from the Albert's order).
 *
 * For now this is a static "covers it generally" map; refine with seasonality
 * when sales-history-by-month is available.
 */
const LOCAL_COVERAGE: Record<string, string> = {
  apples: "Canton Apples / Ferris Ridge (Sep–Mar)",
  microgreens: "House of Greens (year-round)",
  kale: "Kent's / Birdsfoot (May–Oct)",
  spinach: "Birdsfoot (May–Sep)",
  carrots: "Martin's / Kent's (Jun–Mar storage)",
  potatoes: "Martin's (Aug–Apr storage)",
  squash: "Martin's / Kent's (Jul–Mar)",
  cilantro: "Kent's / Birdsfoot (Jun–Oct)",
  parsley: "Kent's / Birdsfoot (May–Oct)",
  scallions: "Kent's / Birdsfoot (Jun–Oct)",
  beets: "Martin's / Kent's (Jun–Feb storage)",
  cucumbers: "Kent's / Birdsfoot (Jul–Sep)",
  tomatoes: "Kent's / Birdsfoot (Jul–Sep)",
  peppers: "Kent's / Birdsfoot (Jul–Sep)",
};

interface OrganicCheck {
  status:
    | 'organic_match'
    | 'no_organic_on_list'
    | 'local_alt_recommended'
    | 'conventional_no_organic_available'   // produce, no organic on list, no local in-season → surface
    | 'not_applicable_non_produce';
  considered_skus: string[];
  reason?: string;
  /** If status is local_alt_recommended, the local supplier hint */
  local_supplier?: string;
}

/**
 * Final-sweep organic check per memory `feedback_no_silent_conventional.md`
 * (refined 2026-05-03: produce-only scope).
 *
 * - Non-produce items (dairy, deli, prepared, packaged) return
 *   `not_applicable_non_produce` immediately. Caller does not need to flag.
 * - Produce items: check for organic on list, then local-coverage, else flag
 *   for review.
 *
 * Returned status drives the exceptions-report block "🚨 Conventional PRODUCE
 * lines about to be sent". Empty block is the goal.
 */
export function organicCheckLine(
  picked: PricelistEntry,
  pricelist: PricelistEntry[],
): OrganicCheck {
  // Non-produce: scope-out entirely. Conv is fine for fresh non-produce.
  if (!isProduceCategory(picked)) {
    return {
      status: 'not_applicable_non_produce',
      considered_skus: [],
      reason: 'fresh non-produce (dairy/deli/prepared) — conv acceptable per brand promise scope',
    };
  }

  // Already organic? Done.
  if (ORGANIC_PROD_TYPES.has(picked.prod_type)) {
    return { status: 'organic_match', considered_skus: [picked.sku] };
  }

  // Find the primary noun — first comma-separated chunk of the description, lowercased.
  const primaryNoun = (picked.product_desc.split(/[,(]/, 1)[0] ?? picked.product_desc).trim().toLowerCase();

  // Any organic SKU on today's list whose description starts with the same primary noun, in stock?
  const organicCandidates = pricelist.filter((r) =>
    ORGANIC_PROD_TYPES.has(r.prod_type) &&
    !r.availability &&  // in stock
    (r.product_desc.toLowerCase().split(/[,(]/, 1)[0] ?? '').trim() === primaryNoun,
  );

  if (organicCandidates.length > 0) {
    // We picked conv but an organic alternative exists on Albert's. Caller should
    // auto-swap to the first organic candidate. The matcher's organic-default
    // fallback in buildOrder() should prevent reaching this state for new picks;
    // this returns a non-empty considered_skus so the caller swaps.
    return {
      status: 'organic_match',  // reclassify: caller will swap to the organic candidate
      considered_skus: organicCandidates.map((c) => c.sku),
      reason: `auto-swap available: organic alternative(s) on today's list (${organicCandidates.map((c) => c.sku).join(', ')})`,
    };
  }

  // No organic on today's list. Check local-coverage.
  const localHint = LOCAL_COVERAGE[primaryNoun];
  if (localHint) {
    return {
      status: 'local_alt_recommended',
      considered_skus: [],
      reason: `no organic on today's list — local source likely covers this`,
      local_supplier: localHint,
    };
  }

  // Produce, no organic on list, no local-in-season. Surface for Clark approval.
  return {
    status: 'conventional_no_organic_available',
    considered_skus: [],
    reason: `produce line "${primaryNoun}" — no organic SKU on today's list, no local supplier coverage hint. Review before send.`,
  };
}

/**
 * Pure decision logic. Inputs:
 *   - order: the list (post-OCR/cleanup)
 *   - pricelist: today's alberts_price_entries snapshot (filtered to in-stock if possible)
 *   - features: optional per-SKU feature bundle (price_stats, sales velocity, etc.)
 *   - standing: optional SKU+pack-lock map for items like garlic = 5 lb
 */
export function buildOrder(
  order: OrderInput,
  pricelist: PricelistEntry[],
  features: Map<string, FeatureBundle>,
  standing: Map<string, string> = new Map(),  // name → pinned SKU
): BuildResult {
  const decisions: Decision[] = [];
  const openQuestions: string[] = [];
  const availabilityFlags: string[] = [];
  const convUnavoidable: string[] = [];
  const addedPerClark: string[] = [];
  const dropped: string[] = [];
  const convProduceForReview: BuildResult['conv_produce_for_review'] = [];
  const localAltRecommended: BuildResult['local_alt_recommended'] = [];

  // Pre-bucket pricelist by name fragment for fuzzy match
  const lower = (s: string) => s.toLowerCase();

  // First pass: pick a SKU per line.
  let bidsRemaining = BID_MAX_LINES;

  for (const line of order.lines) {
    const pin = line.pinned_sku ?? standing.get(lower(line.name));
    let picked: PricelistEntry | undefined;

    if (pin) {
      picked = pricelist.find((p) => p.sku === pin);
      if (!picked) {
        openQuestions.push(`Pinned SKU ${pin} for "${line.name}" not on today's pricelist`);
        dropped.push(`${line.name} (pinned SKU missing)`);
        continue;
      }
    } else {
      // Fuzzy match — prefer organic, in-stock, smallest pack first
      const matches = pricelist.filter((p) =>
        lower(p.product_desc).includes(lower(line.name)),
      );
      if (matches.length === 0) {
        openQuestions.push(`No pricelist match for "${line.name}"`);
        continue;
      }
      // Sort: organic first, then in-stock, then smallest pack
      matches.sort((a, b) => {
        const aOrg = ORGANIC_PROD_TYPES.has(a.prod_type) ? 0 : 1;
        const bOrg = ORGANIC_PROD_TYPES.has(b.prod_type) ? 0 : 1;
        if (aOrg !== bOrg) return aOrg - bOrg;
        const aAv = a.availability ? 1 : 0;
        const bAv = b.availability ? 1 : 0;
        if (aAv !== bAv) return aAv - bAv;
        return (a.pack ?? 999) - (b.pack ?? 999);
      });
      picked = matches[0];
    }
    if (!picked) continue;

    // Availability flag: "Due Tuesday" etc — drop if Mon truck won't catch it
    if (/Due Tuesday/i.test(picked.availability) && isMondayOrder(order.order_date)) {
      dropped.push(`${picked.product_desc} ${picked.sku} — Due Tuesday won't make 4 AM Tue truck`);
      availabilityFlags.push(`${picked.sku} dropped — Due Tuesday`);
      continue;
    }

    // Organic-default check: warn if we picked a conventional unnecessarily
    const isOrganic = ORGANIC_PROD_TYPES.has(picked.prod_type);
    if (!isOrganic) {
      const orgAlt = pricelist.find((p) =>
        ORGANIC_PROD_TYPES.has(p.prod_type) &&
        lower(p.product_desc).includes(lower(line.name)) &&
        !p.availability,
      );
      if (orgAlt) {
        // There IS an organic alternative — use it instead
        picked = orgAlt;
      } else {
        convUnavoidable.push(`${line.name} ${picked.sku} — no in-stock organic on today's list`);
      }
    }

    // Bid logic
    const feat = features.get(picked.sku);
    let bidPrice: number | null = null;
    if (
      bidsRemaining > 0 &&
      feat?.price_stats &&
      feat.price_stats.pct_vs_avg != null &&
      feat.price_stats.pct_vs_avg > BID_THRESHOLD_PCT &&
      picked.price != null
    ) {
      bidPrice = round(feat.price_stats.avg90 ?? picked.price, 0);
      bidsRemaining -= 1;
    }

    const supplierNotes: string[] = [];
    const internalNotes: string[] = [];
    const both: string[] = [];

    // Audience routing: hand-written notes go in both; rationale goes internal
    if (line.notes) supplierNotes.push(line.notes);
    if ((line.qty ?? 1) > 1) supplierNotes.push(`${line.qty} cases`);
    if (line.so_customer) {
      supplierNotes.push(`Special Order`);
      internalNotes.push(`S/O: ${line.so_customer}${line.so_phone ? ' ' + line.so_phone : ' (phone missing)'}`);
    }
    if (bidPrice != null) {
      supplierNotes.push(`Case for $${bidPrice} so these move please.`);
      internalNotes.push(`bid: list $${picked.price}, 90d avg $${feat?.price_stats?.avg90 ?? '?'}, ${feat?.price_stats?.pct_vs_avg?.toFixed(1)}%`);
    }
    if (feat?.inventory && feat.inventory.qty_on_hand != null && feat.inventory.qty_on_hand > 0) {
      internalNotes.push(`have ${feat.inventory.qty_on_hand} on hand (conf ${feat.inventory.confidence})`);
    }
    if (!isOrganic) {
      internalNotes.push('conv unavoidable — no in-stock organic on list');
    }

    // ---- Final-sweep organic check (per memory feedback_no_silent_conventional.md, 2026-05-03 produce-only scope) ----
    // Non-produce items short-circuit to not_applicable_non_produce — conv is
    // fine for fresh non-produce. Produce items run the full check:
    //   - organic_match (with non-empty considered_skus → auto-swap)
    //   - local_alt_recommended → flag in BuildResult.local_alt_recommended
    //   - conventional_no_organic_available → flag in BuildResult.conv_produce_for_review
    const orgCheck = organicCheckLine(picked, pricelist);

    // Auto-swap when the check found organic alternatives we should have picked
    if (orgCheck.status === 'organic_match' && orgCheck.considered_skus.length > 0 && !ORGANIC_PROD_TYPES.has(picked.prod_type)) {
      const altSku = orgCheck.considered_skus[0];
      const alt = pricelist.find((p) => p.sku === altSku);
      if (alt) {
        internalNotes.push(`auto-swap: original pick ${picked.sku} (conv) -> ${alt.sku} organic per final-sweep`);
        picked = alt;
      }
    } else if (orgCheck.status === 'local_alt_recommended') {
      localAltRecommended.push({
        sku: picked.sku,
        description: picked.product_desc,
        local_supplier: orgCheck.local_supplier ?? '',
      });
      internalNotes.push(`local alt recommended: ${orgCheck.local_supplier} — consider sourcing locally instead`);
    } else if (orgCheck.status === 'conventional_no_organic_available') {
      convProduceForReview.push({
        sku: picked.sku,
        description: picked.product_desc,
        reason: orgCheck.reason ?? '',
      });
      internalNotes.push('⚠️ conv produce — no organic on list, no local source. Review in exceptions before send.');
    }

    const d = newDecision({
      sku: picked.sku,
      item_name: line.name,
      description: picked.product_desc,
      requested_qty: line.qty ?? 1,
      final_qty: line.qty ?? 1,
    });
    d.bid_price = bidPrice;
    d.supplier_facing = supplierNotes;
    d.internal_po = internalNotes;
    d.both = both;
    d.features = featuresToSnapshot(feat);
    // Re-run organicCheckLine after the auto-swap above so the recorded status
    // reflects the FINAL pick (not the pre-swap conv).
    const finalOrgCheck = organicCheckLine(picked, pricelist);
    d.features['produce_classification'] = {
      name: 'produce_classification',
      value: {
        status: finalOrgCheck.status,
        considered_skus: finalOrgCheck.considered_skus,
        reason: finalOrgCheck.reason ?? '',
        local_supplier: finalOrgCheck.local_supplier ?? '',
      },
    };
    d.rationale = [
      finalOrgCheck.status === 'organic_match' ? 'organic produce' :
        finalOrgCheck.status === 'not_applicable_non_produce' ? 'fresh non-produce — conv acceptable' :
        finalOrgCheck.status === 'local_alt_recommended' ? `local alt recommended: ${finalOrgCheck.local_supplier}` :
        finalOrgCheck.status === 'conventional_no_organic_available' ? '⚠️ conv produce — review before send' :
        finalOrgCheck.status === 'no_organic_on_list' ? 'no organic on list' :
        finalOrgCheck.status,
      bidPrice != null ? `bid sized to 90d avg ($${bidPrice})` : '',
      line.so_customer ? `S/O for ${line.so_customer}` : '',
    ].filter(Boolean);

    decisions.push(d);
    if (line.notes && /add(ed)?|new/i.test(line.notes)) addedPerClark.push(`${picked.sku} ${picked.product_desc}`);
  }

  // Totals
  const subtotalCents = decisions.reduce((acc, d) => {
    const price = d.features.price_stats?.value?.current as number | undefined;
    if (price == null) return acc;
    return acc + Math.round(price * d.final_qty * 100);
  }, 0);
  const subtotalIfBidsCents = decisions.reduce((acc, d) => {
    const price = d.features.price_stats?.value?.current as number | undefined;
    const effective = d.bid_price ?? price ?? 0;
    return acc + Math.round(effective * d.final_qty * 100);
  }, 0);

  // Pre-render notes
  for (const d of decisions) {
    d.features['_rendered'] = {
      name: '_rendered',
      value: { supplier: supplierNoteText(d), internal: internalPoText(d) },
    };
  }

  return {
    decisions,
    subtotal_cents: subtotalCents,
    subtotal_if_bids_cents: subtotalIfBidsCents,
    open_questions: openQuestions,
    availability_flags: availabilityFlags,
    conv_unavoidable: convUnavoidable,
    added_per_clark: addedPerClark,
    dropped,
    conv_produce_for_review: convProduceForReview,
    local_alt_recommended: localAltRecommended,
  };
}

function featuresToSnapshot(f: FeatureBundle | undefined): Decision['features'] {
  if (!f) return {};
  const out: Decision['features'] = {};
  for (const [k, v] of Object.entries(f)) {
    out[k] = { name: k, value: v as Record<string, unknown> };
  }
  return out;
}

function isMondayOrder(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.getUTCDay() === 1; // 0=Sun, 1=Mon
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
