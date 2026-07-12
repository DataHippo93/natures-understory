// Wholesale pricing data layer — LoPro store. Server-only.
//
// Tier model (non-Plus plan — catalogs route through B2B markets):
//   Company Location → B2B market → catalog → price list
// Env: WHOLESALE_T1_PRICE_LIST_ID, WHOLESALE_T2_PRICE_LIST_ID
//      WHOLESALE_T1_PUBLICATION_ID, WHOLESALE_T2_PUBLICATION_ID (v7.7.11)
// Optional env: WHOLESALE_T1_CATALOG_ID, WHOLESALE_T2_CATALOG_ID
//   (for recipient tier mapping; falls back to title match on "Tier 1"/"Tier 2")
//
// v7.7.11 (2026-07-12) — BULLETPROOF WHOLESALE PUBLICATION:
//   Shopify B2B contextual pricing needs TWO things per variant:
//     (1) a price entry in the tier PriceList
//     (2) the parent product PUBLISHED to the tier Catalog Publication
//   Prior versions did (1) only. Result: silent invisible prices — a
//   variant would have a Tier 1 price in Shopify but wouldn't return
//   from contextualPricing because the product wasn't in the T1
//   catalog publication. Bulk-run diagnostic on 2026-07-11 showed 91
//   T1 price entries against only 29 products actually published to
//   the T1 catalog — 60+ SKUs silently broken.
//
//   Fix, in three layers of defense:
//     - Save-time: `upsertTierPrice` now also publishes the parent to
//       the tier's catalog publication (idempotent, logged).
//     - Toggle-time: `setVariantWholesaleActive(id, true)` publishes to
//       BOTH catalogs (no harm publishing to one that has no prices).
//       `setVariantWholesaleActive(id, false)` clears prices then
//       unpublishes each tier where no variant of the parent product
//       has any remaining price entry.
//     - Cron: `/api/cron/wholesale-reconcile` runs `reconcilePublications`
//       nightly — computes the delta between each tier's price-list
//       products and its catalog publication, publishes any missing.
//   Every action is logged to `wholesale_publication_backfill_log`
//   in Supabase (source, tier, product_id, action, ok, user_errors).
//
//   `custom.wholesale_active` metafield: kept as an internal
//   "operator intent" flag (drives the row-opacity + `active` filter in
//   the UI), but is NO LONGER treated as if Shopify gates on it —
//   because Shopify doesn't. The checkbox label in the grid header is
//   renamed "Enable pricing" to reflect what it actually does: it
//   triggers the publish/unpublish + price-clear plumbing.
//
// v7.4 (2026-07-07):
//   - Variant-level wholesale_active metafield (product-level kept as fallback
//     during backfill).
//   - Tier price fetch now surfaces RELATIVE-origin prices too (was FIXED-only,
//     which showed blank when the tier price list uses a market catalog
//     percentage adjustment instead of per-variant overrides).
//   - Recipients auto-derived from Company Location catalog assignments +
//     Company Contact customer records. Read-only; managed in Shopify Admin.
//
// v7.7.3 (2026-07-08):
//   - Each grid row now carries an `adminUrl` pointing at the Shopify Admin
//     variant edit page, so Daniel can jump straight from a row to the
//     product/variant to edit fields we don't surface here (media,
//     description) or check inventory history. Handle derived from
//     LOPRO_SHOPIFY_SHOP (stripping `.myshopify.com`); falls back to
//     `natures-storehouse` if unset. Also exported as `shopify_admin_url`
//     column in the CSV.
//
// v7.7.2 (2026-07-08):
//   - Same 1038-cost throw was still hitting the Recipients tab AND both
//     Pricelist buttons (the pricelist route composes loadGrid +
//     loadRecipients, so any over-budget query in loadRecipients breaks the
//     tier email draft too). loadRecipients query trimmed: companies 50->25,
//     locations 20->10, roleAssignments 50->20. catalogs stays at 5. Same
//     total throughput via cursor pagination.
//
// v7.7.1 (2026-07-08):
//   - Products page size 250 → 50. Adding `inventoryItem { unitCost { amount } }`
//     in v7.7 pushed the products query cost to 1038, over Shopify's 1000-point
//     single-query cap, and the endpoint was throwing on every load. Dropping
//     the outer `first:` scales the cost down ~5× (est. ~208), well under the
//     limit. Same total throughput — just more pages.
//
// v7.7.9 (2026-07-09):
//   - v7.7.8 fallback code shipped but recipients tab STILL showed 0/0/0.
//     Two candidate root causes: (a) module-level _recipientCache holding
//     a stale zero result from before v7.7.8 across warm invocations, or
//     (b) the combined companies+contacts+locations query throwing
//     silently and the catch returning empty without ever reaching the
//     name-hint fallback.
//   - Fix: split loadRecipients into a cheap companies(first:50){id,name}
//     pass FIRST, then per-company detail queries. Per-company failures
//     no longer abort the whole run. Name-hint fallback + built-in known
//     GID defaults run on EVERY company, unioned with catalog results.
//     Natures Storehouse GID is baked in as a final default so this
//     store always has at least one Tier 1 company even during a full
//     Shopify outage. Cache TTL dropped 10 min -> 30s. Route uses
//     force-dynamic + revalidate=0.
//
// v7.7.8 (2026-07-09):
//   - Recipients tab was still showing 0/0 even after v7.7.7 because
//     `companyLocation.catalogs` returns an empty edge list on this store
//     for the "Wholesale Tier 1" / "Wholesale Tier 2" MarketCatalogs. The
//     Admin UI shows the catalog assigned at Company/Location level, but
//     the assignment routes through Markets on non-Plus plans and the
//     location.catalogs connection only enumerates CompanyLocationCatalogs
//     (not MarketCatalogs). Confirmed live: companyLocation.catalogsCount
//     = 0 for Nature's Storehouse even though the UI shows Tier 1.
//   - Fix: (a) hardcode both known MarketCatalog GIDs into catalogTier()
//     so the env vars are optional. (b) company-name-based fallback: any
//     Company whose locations all return empty catalogs is matched against
//     WHOLESALE_T1_COMPANY_NAME_HINTS / _T2_ env-var CSVs (defaults include
//     the two known production companies + "tier 1"/"tier 2" substrings).
//     (c) explicit WHOLESALE_T1_COMPANY_GIDS / _T2_ env-var lists win over
//     everything else. Root cause diagnosed via v7.7.8 diagnostic; response
//     body captured in commit message.
//
// v7.7.7 (2026-07-09):
//   - Drop company.orders selection entirely. LoPro app lacks read_orders
//     scope, so Shopify returned ACCESS_DENIED which fails the whole query.
//     v7.7.6 fixed the parse error but this second error was still 500ing.
//   - Balances render as zero for all companies. Recipients list functional.
//     To restore: add read_orders to LoPro scopes, re-mint token, revert.
//
// v7.7.6 (2026-07-09):
//   - Fix Shopify GraphQL error "Field 'orders' doesn't accept argument
//     'query'" — that arg only exists on QueryRoot.orders, not on the nested
//     Company.orders connection. The v7.7.5 balances query was failing the
//     whole recipients fetch, leaving the Recipients tab empty.
//   - Now: fetch first 50 recent orders per company (sorted DESC), filter
//     client-side by displayFinancialStatus !== 'PAID' and outstanding > 0.
//
// v7.7.5 (2026-07-08):
//   - Recipient bug fix: contacts who are Company Contacts but not
//     role-assigned at a specific Location were being dropped by the old
//     `location.roleAssignments` -only traversal. loadRecipients now also
//     walks `company.contacts` and unions the two sources. Tier flags for
//     `company.contacts` -derived recipients use the union of all the
//     company's location tier flags (a contact who can buy at ANY tier-N
//     location is a valid tier-N pricelist recipient).
//   - Account balances: new `tierBalances` field on RecipientList. Sums
//     `totalOutstandingSet.presentmentMoney.amount` across each company's
//     `orders(query: "-financial_status:paid")` and buckets by the
//     company's tier flags. Rendered on the Recipients tab.

import { shopifyGraphQL, assertNoUserErrors } from './shopify-lopro';

export type Tier = 't1' | 't2';

function priceListId(tier: Tier): string {
  const id = tier === 't1' ? process.env.WHOLESALE_T1_PRICE_LIST_ID : process.env.WHOLESALE_T2_PRICE_LIST_ID;
  if (!id) throw new Error(`Missing price list env for ${tier}`);
  return id;
}

// v7.7.11: catalog publication IDs — required for the
// contextualPricing pipeline to actually resolve tier prices.
function publicationId(tier: Tier): string {
  const id =
    tier === 't1' ? process.env.WHOLESALE_T1_PUBLICATION_ID : process.env.WHOLESALE_T2_PUBLICATION_ID;
  if (!id) throw new Error(`Missing publication env for ${tier}`);
  return id;
}

// v7.7.3: derive Shopify Admin base URL from LOPRO_SHOPIFY_SHOP
// (e.g. "0xdj5s-hq.myshopify.com" -> "https://admin.shopify.com/store/0xdj5s-hq").
// Falls back to `natures-storehouse` if the env var is unset so pages don't
// crash — they'd just land on a store the user might not have access to.
function shopifyAdminBase(): string {
  const shop = process.env.LOPRO_SHOPIFY_SHOP ?? '';
  const handle = shop.replace(/\.myshopify\.com$/, '') || 'natures-storehouse';
  return `https://admin.shopify.com/store/${handle}`;
}

function shopifyAdminUrl(productGid: string, variantGid: string): string {
  // Shopify GIDs: gid://shopify/Product/12345678 -> keep everything after the last slash.
  const p = productGid.slice(productGid.lastIndexOf('/') + 1);
  const v = variantGid.slice(variantGid.lastIndexOf('/') + 1);
  return `${shopifyAdminBase()}/products/${p}/variants/${v}`;
}

// v7.7.5: Company admin URL (for the balance rows on the Recipients tab).
function shopifyCompanyAdminUrl(companyGid: string): string {
  const id = companyGid.slice(companyGid.lastIndexOf('/') + 1);
  return `${shopifyAdminBase()}/companies/${id}`;
}

// v7.7.8: hardcoded MarketCatalog GIDs for the Nature's Storehouse LoPro
// store (0xdj5s-hq). Env vars WHOLESALE_T1_CATALOG_ID / _T2_ still take
// precedence — this is a floor so the mapping works even when Vercel envs
// are unset.
const T1_CATALOG_GID_DEFAULT = 'gid://shopify/MarketCatalog/155448869111';
const T2_CATALOG_GID_DEFAULT = 'gid://shopify/MarketCatalog/155473641719';

function catalogTier(catalogId: string, catalogTitle: string): Tier | null {
  const t1id = process.env.WHOLESALE_T1_CATALOG_ID ?? T1_CATALOG_GID_DEFAULT;
  const t2id = process.env.WHOLESALE_T2_CATALOG_ID ?? T2_CATALOG_GID_DEFAULT;
  if (t1id && catalogId === t1id) return 't1';
  if (t2id && catalogId === t2id) return 't2';
  const t = catalogTitle.toLowerCase();
  if (t.includes('tier 1') || t.endsWith(' t1')) return 't1';
  if (t.includes('tier 2') || t.endsWith(' t2')) return 't2';
  return null;
}

// v7.7.8: fallback tier detection for the case where a Company's locations
// all report empty `catalogs` (MarketCatalog assignments don't surface
// through location.catalogs). Order of precedence:
//   1. WHOLESALE_T1_COMPANY_GIDS / _T2_ env-var CSV (exact GID match)
//   2. WHOLESALE_T1_COMPANY_NAME_HINTS / _T2_ env-var CSV (case-insensitive
//      substring match)
//   3. Built-in hints: "tier 1"/"tier 2" substrings + "nature's storehouse"
//      (production Tier 1 company on this store).
// Returns { t1, t2 } — both true is allowed (rare but possible when a
// company spans both tiers).
function csvEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function companyTierFallback(
  companyGid: string,
  companyName: string
): { t1: boolean; t2: boolean } {
  const nameLower = companyName.toLowerCase();

  const gidT1 = csvEnv('WHOLESALE_T1_COMPANY_GIDS');
  const gidT2 = csvEnv('WHOLESALE_T2_COMPANY_GIDS');
  if (gidT1.includes(companyGid) || gidT2.includes(companyGid)) {
    return { t1: gidT1.includes(companyGid), t2: gidT2.includes(companyGid) };
  }

  const nameT1 = [
    ...csvEnv('WHOLESALE_T1_COMPANY_NAME_HINTS'),
    // built-in defaults for this store
    'tier 1',
    "nature's storehouse",
  ].map((s) => s.toLowerCase());
  const nameT2 = [
    ...csvEnv('WHOLESALE_T2_COMPANY_NAME_HINTS'),
    'tier 2',
  ].map((s) => s.toLowerCase());

  const t1 = nameT1.some((h) => h && nameLower.includes(h));
  const t2 = nameT2.some((h) => h && nameLower.includes(h));
  return { t1, t2 };
}

export interface GridRow {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  retail: string;
  lotCost: string | null; // v7.7: inventoryItem.unitCost.amount; null if unset
  tier1: string | null; // resolved price (FIXED override wins; else RELATIVE from catalog); null = variant not in list
  tier2: string | null;
  wholesaleActive: boolean; // per-variant
  adminUrl: string; // v7.7.3: Shopify Admin variant edit URL
}

// ---------- Grid reads ----------

interface ProductsPage {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      title: string;
      metafield: { value: string } | null;
      variants: {
        nodes: Array<{
          id: string;
          title: string;
          price: string;
          metafield: { value: string } | null;
          inventoryItem: { unitCost: { amount: string } | null } | null;
        }>;
      };
    }>;
  };
}

interface PriceListPrices {
  priceList: {
    prices: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{ variant: { id: string }; price: { amount: string }; originType: string }>;
    };
  };
}

async function fetchTierPrices(tier: Tier): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const data: PriceListPrices = await shopifyGraphQL<PriceListPrices>(
      `query($id: ID!, $cursor: String) {
        priceList(id: $id) {
          prices(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { variant { id } price { amount } originType }
          }
        }
      }`,
      { id: priceListId(tier), cursor }
    );
    // v7.4: surface BOTH FIXED overrides and RELATIVE (market-adjusted)
    // resolutions. Shopify already resolves the amount either way, so a
    // simple `map.set` gives the right cell value. Previously we filtered
    // `originType === 'FIXED'` and dropped every price when the catalog
    // used a percentage adjustment, leaving the T1/T2 columns blank.
    for (const p of data.priceList.prices.nodes) {
      map.set(p.variant.id, p.price.amount);
    }
    cursor = data.priceList.prices.pageInfo.hasNextPage
      ? data.priceList.prices.pageInfo.endCursor
      : null;
  } while (cursor);
  return map;
}

/** Full grid load: one row per variant + retail + resolved tier prices + per-variant active flag. */
export async function loadGrid(): Promise<GridRow[]> {
  const rows: GridRow[] = [];
  const [t1, t2] = await Promise.all([fetchTierPrices('t1'), fetchTierPrices('t2')]);

  let cursor: string | null = null;
  do {
    const data: ProductsPage = await shopifyGraphQL<ProductsPage>(
      `query($cursor: String) {
        products(first: 50, after: $cursor, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title
            metafield(namespace: "custom", key: "wholesale_active") { value }
            variants(first: 50) {
              nodes {
                id title price
                metafield(namespace: "custom", key: "wholesale_active") { value }
                inventoryItem { unitCost { amount } }
              }
            }
          }
        }
      }`,
      { cursor }
    );
    for (const p of data.products.nodes) {
      // Product flag is the backwards-compat fallback for variants that
      // haven't been touched since v7.3 (when the flag lived only at product
      // scope). Any explicit variant-level value overrides the product's.
      const productActive = p.metafield?.value === 'true';
      for (const v of p.variants.nodes) {
        const raw = v.metafield?.value;
        const variantActive = raw === 'true' ? true : raw === 'false' ? false : productActive;
        rows.push({
          productId: p.id,
          productTitle: p.title,
          variantId: v.id,
          variantTitle: v.title,
          retail: v.price,
          lotCost: v.inventoryItem?.unitCost?.amount ?? null,
          tier1: t1.get(v.id) ?? null,
          tier2: t2.get(v.id) ?? null,
          wholesaleActive: variantActive,
          adminUrl: shopifyAdminUrl(p.id, v.id),
        });
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return rows;
}

// ---------- Publication helpers (v7.7.11) ----------

/** Fire-and-forget insert into wholesale_publication_backfill_log. Never throws. */
async function logPublishAction(row: {
  source: 'save_handler' | 'toggle' | 'cron' | 'backfill' | 'manual';
  tier: 't1' | 't2';
  publication_id: string;
  product_id: string;
  action: 'publish' | 'unpublish' | 'skip_already_published' | 'skip_no_price';
  ok: boolean;
  user_errors?: unknown;
  note?: string | null;
}): Promise<void> {
  try {
    const url = (process.env.UNDERSTORY_SUPABASE_URL ?? '').replace(/\/+$/, '');
    const key = process.env.UNDERSTORY_SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/wholesale_publication_backfill_log`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ...row,
        tier: row.tier.toUpperCase(),
        user_errors: row.user_errors ?? null,
        note: row.note ?? null,
      }),
      cache: 'no-store',
    });
  } catch (e) {
    console.warn('[wholesale] logPublishAction failed:', (e as Error).message);
  }
}

/** Resolve the parent product ID for a given variant ID. */
async function getProductIdForVariant(variantId: string): Promise<string> {
  const data = await shopifyGraphQL<{ productVariant: { product: { id: string } } | null }>(
    `query($id: ID!) { productVariant(id: $id) { product { id } } }`,
    { id: variantId }
  );
  const id = data.productVariant?.product?.id;
  if (!id) throw new Error(`No parent product for variant ${variantId}`);
  return id;
}

/** Return the set of variant IDs belonging to a product. */
async function fetchProductVariantIds(productId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const data = await shopifyGraphQL<{
    product: { variants: { nodes: Array<{ id: string }> } } | null;
  }>(
    `query($id: ID!) {
      product(id: $id) { variants(first: 100) { nodes { id } } }
    }`,
    { id: productId }
  );
  for (const v of data.product?.variants?.nodes ?? []) ids.add(v.id);
  return ids;
}

/**
 * Idempotently publish a product to a tier's catalog publication. If the
 * product is already published, this is a no-op (`skip_already_published`
 * is logged). Never unpublishes; safe to call whenever a price is written.
 */
export async function ensureProductPublishedToTier(
  productId: string,
  tier: Tier,
  source: 'save_handler' | 'toggle' | 'cron' | 'backfill'
): Promise<{ ok: boolean; alreadyPublished: boolean; userErrors: unknown[] }> {
  const pubId = publicationId(tier);

  // Check first — cheaper than mutating if already published.
  const check = await shopifyGraphQL<{
    product: { publishedOnPublication: boolean } | null;
  }>(
    `query($id: ID!, $pubId: ID!) {
      product(id: $id) { publishedOnPublication(publicationId: $pubId) }
    }`,
    { id: productId, pubId }
  );
  if (check.product?.publishedOnPublication) {
    await logPublishAction({
      source,
      tier,
      publication_id: pubId,
      product_id: productId,
      action: 'skip_already_published',
      ok: true,
    });
    return { ok: true, alreadyPublished: true, userErrors: [] };
  }

  const mut = await shopifyGraphQL<{
    publishablePublish: {
      publishable: { publishedOnPublication: boolean } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(
    `mutation Publish($id: ID!, $pubId: ID!) {
      publishablePublish(id: $id, input: [{ publicationId: $pubId }]) {
        publishable { ... on Product { publishedOnPublication(publicationId: $pubId) } }
        userErrors { field message }
      }
    }`,
    { id: productId, pubId }
  );

  const errs = mut.publishablePublish.userErrors ?? [];
  const nowPub = mut.publishablePublish.publishable?.publishedOnPublication ?? false;
  const ok = errs.length === 0 && nowPub;
  await logPublishAction({
    source,
    tier,
    publication_id: pubId,
    product_id: productId,
    action: 'publish',
    ok,
    user_errors: errs.length ? errs : null,
  });
  if (!ok) console.warn('[wholesale] ensurePublish failed', productId, tier, errs);
  return { ok, alreadyPublished: false, userErrors: errs };
}

/**
 * If NONE of the product's variants have a price in the given tier's
 * price list, remove the product from that tier's catalog publication.
 * Used by the toggle-OFF path so a cleanly disabled product actually
 * disappears from the wholesale catalog.
 */
export async function unpublishFromTierIfEmpty(
  productId: string,
  tier: Tier,
  source: 'toggle' | 'cron'
): Promise<{ unpublished: boolean }> {
  const pubId = publicationId(tier);
  const variantIds = await fetchProductVariantIds(productId);
  if (variantIds.size === 0) return { unpublished: false };

  // Any variant of this product still priced in the tier?
  const tierMap = await fetchTierPrices(tier);
  for (const vid of variantIds) {
    if (tierMap.has(vid)) {
      await logPublishAction({
        source,
        tier,
        publication_id: pubId,
        product_id: productId,
        action: 'skip_no_price', // misnomer — "skip: still has prices"
        ok: true,
        note: 'still has priced variants; not unpublishing',
      });
      return { unpublished: false };
    }
  }

  const mut = await shopifyGraphQL<{
    publishableUnpublish: {
      publishable: { publishedOnPublication: boolean } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(
    `mutation Unpub($id: ID!, $pubId: ID!) {
      publishableUnpublish(id: $id, input: [{ publicationId: $pubId }]) {
        publishable { ... on Product { publishedOnPublication(publicationId: $pubId) } }
        userErrors { field message }
      }
    }`,
    { id: productId, pubId }
  );

  const errs = mut.publishableUnpublish.userErrors ?? [];
  const stillPub = mut.publishableUnpublish.publishable?.publishedOnPublication ?? false;
  const ok = errs.length === 0 && !stillPub;
  await logPublishAction({
    source,
    tier,
    publication_id: pubId,
    product_id: productId,
    action: 'unpublish',
    ok,
    user_errors: errs.length ? errs : null,
  });
  if (!ok) console.warn('[wholesale] unpublish failed', productId, tier, errs);
  return { unpublished: ok };
}

/**
 * Full reconciliation pass: for each tier, publish every product that has
 * a price-list entry but is missing from the tier catalog publication.
 * Used by the nightly cron self-heal and by ops backfills. Never
 * unpublishes here — that's a destructive action reserved for the
 * toggle-off path.
 */
export async function reconcilePublications(
  source: 'cron' | 'backfill'
): Promise<{
  t1: { checked: number; published: number; errors: number };
  t2: { checked: number; published: number; errors: number };
}> {
  const out = {
    t1: { checked: 0, published: 0, errors: 0 },
    t2: { checked: 0, published: 0, errors: 0 },
  };
  for (const tier of ['t1', 't2'] as Tier[]) {
    const priceMap = await fetchTierPrices(tier);
    // Collect distinct parent products from priced variants.
    // fetchTierPrices returns variantId → amount, so we need to look up
    // parents. Batch via aliased query, 40 at a time.
    const variantIds = [...priceMap.keys()];
    const parents = new Set<string>();
    for (let i = 0; i < variantIds.length; i += 40) {
      const chunk = variantIds.slice(i, i + 40);
      const q = `query { ${chunk
        .map(
          (id, j) => `v${j}: productVariant(id: "${id}") { product { id } }`
        )
        .join(' ')} }`;
      const res = await shopifyGraphQL<Record<string, { product: { id: string } } | null>>(q);
      for (let j = 0; j < chunk.length; j++) {
        const p = res[`v${j}`]?.product?.id;
        if (p) parents.add(p);
      }
    }

    const parentIds = [...parents];
    out[tier].checked = parentIds.length;
    for (const pid of parentIds) {
      const r = await ensureProductPublishedToTier(pid, tier, source);
      if (r.ok && !r.alreadyPublished) out[tier].published += 1;
      if (!r.ok) out[tier].errors += 1;
    }
  }
  return out;
}

// ---------- Price writes ----------

export async function updateRetailPrice(productId: string, variantId: string, price: string): Promise<void> {
  const data = await shopifyGraphQL<{
    productVariantsBulkUpdate: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    { productId, variants: [{ id: variantId, price }] }
  );
  assertNoUserErrors(data.productVariantsBulkUpdate.userErrors, 'updateRetailPrice');
}

/** Upsert a tier fixed price (priceListFixedPricesAdd = add-or-replace).
 *
 * v7.7.11: after the price is added, ensure the parent product is published
 * to the tier's catalog publication — without this, Shopify's contextual
 * pricing pipeline silently returns null for the tier price even though the
 * price-list entry exists. The publish is idempotent and its failure is
 * logged but NOT propagated: the price write itself succeeded, and the
 * nightly cron will re-attempt the publish on any product that missed it.
 */
export async function upsertTierPrice(tier: Tier, variantId: string, amount: string): Promise<void> {
  const data = await shopifyGraphQL<{
    priceListFixedPricesAdd: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(
    `mutation($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
      priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
        userErrors { field message }
      }
    }`,
    {
      priceListId: priceListId(tier),
      prices: [{ variantId, price: { amount, currencyCode: 'USD' } }],
    }
  );
  assertNoUserErrors(data.priceListFixedPricesAdd.userErrors, `upsertTierPrice(${tier})`);

  // v7.7.11: bulletproof catalog publication.
  try {
    const productId = await getProductIdForVariant(variantId);
    await ensureProductPublishedToTier(productId, tier, 'save_handler');
  } catch (e) {
    console.warn('[wholesale] upsertTierPrice publish step warning:', (e as Error).message);
  }
}

export async function clearTierPrice(tier: Tier, variantId: string): Promise<void> {
  const data = await shopifyGraphQL<{
    priceListFixedPricesDelete: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(
    `mutation($priceListId: ID!, $variantIds: [ID!]!) {
      priceListFixedPricesDelete(priceListId: $priceListId, variantIds: $variantIds) {
        userErrors { field message }
      }
    }`,
    { priceListId: priceListId(tier), variantIds: [variantId] }
  );
  assertNoUserErrors(data.priceListFixedPricesDelete.userErrors, `clearTierPrice(${tier})`);
}

// ---------- Toggle (v7.4: variant-level; v7.7.11: publishes catalog) ----------

/**
 * Toggle a single variant's wholesale_active metafield AND drive the
 * corresponding Shopify catalog publication state for the parent product.
 *
 * v7.7.11 semantics:
 *   on:  variant metafield -> 'true'
 *        parent product   -> publishablePublish to BOTH T1 and T2 catalogs
 *                            (idempotent; publishing to a tier that has no
 *                            price for this variant is harmless — Shopify
 *                            simply won't resolve a contextual price there)
 *   off: variant metafield -> 'false'
 *        variant tier prices -> cleared from BOTH price lists
 *        parent product -> for each tier, unpublish IF no variant of the
 *                          product still has a price in that tier's list
 *
 * The metafield is retained purely as an internal "operator intent" flag
 * so the UI can dim disabled rows and default the filter to enabled items.
 * Prior versions treated the metafield as if Shopify honored it — Shopify
 * does not; the catalog publication + price-list entry are what actually
 * make a variant show up at wholesale. Root cause: 2026-07-11 diagnostic.
 */
export async function setVariantWholesaleActive(variantId: string, active: boolean): Promise<void> {
  const meta = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(
    `mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      metafields: [
        {
          ownerId: variantId,
          namespace: 'custom',
          key: 'wholesale_active',
          type: 'boolean',
          value: active ? 'true' : 'false',
        },
      ],
    }
  );
  assertNoUserErrors(meta.metafieldsSet.userErrors, 'setVariantWholesaleActive.metafieldsSet');

  // Best-effort resolve parent — used by both branches below.
  let productId: string | null = null;
  try {
    productId = await getProductIdForVariant(variantId);
  } catch (e) {
    console.warn('[wholesale] toggle: parent lookup failed:', (e as Error).message);
  }

  if (active) {
    if (productId) {
      for (const tier of ['t1', 't2'] as Tier[]) {
        try {
          await ensureProductPublishedToTier(productId, tier, 'toggle');
        } catch (e) {
          console.warn('[wholesale] toggle-on publish warning:', tier, (e as Error).message);
        }
      }
    }
  } else {
    // Clear prices first, then reassess publication state.
    for (const tier of ['t1', 't2'] as Tier[]) {
      try {
        await clearTierPrice(tier, variantId);
      } catch {
        // variant had no fixed override in this list — fine
      }
    }
    if (productId) {
      for (const tier of ['t1', 't2'] as Tier[]) {
        try {
          await unpublishFromTierIfEmpty(productId, tier, 'toggle');
        } catch (e) {
          console.warn('[wholesale] toggle-off unpublish warning:', tier, (e as Error).message);
        }
      }
    }
  }
}

// ---------- Recipients (v7.4: auto from B2B Companies; v7.7.9: split pass + hard defaults) ----------

export interface Recipient {
  customerId: string;
  email: string;
  displayName: string;
  companyName: string;
  t1: boolean;
  t2: boolean;
  optedOut: boolean; // marketingState !== 'SUBSCRIBED'
}

// v7.7.5: per-company outstanding balance, bucketed by tier for the
// Recipients-tab summary. Zero-balance entries are included so the client
// can offer a "show 0-balance (N)" toggle.
export interface TierBalance {
  companyId: string;
  companyName: string;
  balance: string; // decimal-string USD, e.g. "432.10"; may be "0.00"
  adminUrl: string;
}

export interface RecipientList {
  recipients: Recipient[]; // includes opted-out (client filters); sorted by company then email
  suppressedCount: number; // opted-out count for the UI hint
  tierBalances: { t1: TierBalance[]; t2: TierBalance[] };
}

interface CustomerNode {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  emailMarketingConsent: { marketingState: string } | null;
}

interface CompanyContactNode {
  customer: CustomerNode | null;
}

// v7.7.9: known Company GIDs on this LoPro store. When a company appears
// here it gets the corresponding tier flag unconditionally -- belt-and-
// suspenders for the case where BOTH the catalog traversal AND the name
// hint fail. Overridden by WHOLESALE_T1_COMPANY_GIDS / _T2_ env vars.
const KNOWN_T1_COMPANY_GIDS = new Set<string>([
  'gid://shopify/Company/12610175223', // Nature's Storehouse
]);
const KNOWN_T2_COMPANY_GIDS = new Set<string>([]);

interface CompanyListPage {
  companies: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ id: string; name: string }>;
  };
}

interface CompanyDetail {
  company: {
    id: string;
    name: string;
    contacts: { nodes: Array<CompanyContactNode> };
    locations: {
      nodes: Array<{
        id: string;
        name: string;
        catalogs: { nodes: Array<{ id: string; title: string }> };
        roleAssignments: {
          nodes: Array<{ companyContact: CompanyContactNode | null }>;
        };
      }>;
    };
  } | null;
}

let _recipientCache: { at: number; data: RecipientList } | null = null;
const RECIPIENT_TTL_MS = 30 * 1000; // v7.7.9: 10 min -> 30s

// v7.7.9: bulletproof recipients loader.
//
// Flow:
//   1. Cheap enumeration: companies(first: 50) { id name }. If it throws,
//      we swallow the error -- but not before applying the known-GID
//      defaults (a synthetic Nature's Storehouse row) so the Tier 1 email
//      path stays usable even during a Shopify outage.
//   2. Per-company detail: fetch contacts + locations one company at a
//      time. Failures on individual companies do NOT abort the whole run
//      -- they just leave that company with tier=fallback and no resolved
//      contacts (still surfaces the balance row).
//   3. Tier assignment: catalog match UNION env GID list UNION env name
//      hints UNION built-in hints UNION built-in GID defaults. Runs on
//      EVERY company, not only when the catalog loop returns empty.
export async function loadRecipients(): Promise<RecipientList> {
  if (_recipientCache && Date.now() - _recipientCache.at < RECIPIENT_TTL_MS) {
    return _recipientCache.data;
  }

  const byCustomer = new Map<
    string,
    { c: CustomerNode; companyName: string; t1: boolean; t2: boolean }
  >();
  const t1Balances: TierBalance[] = [];
  const t2Balances: TierBalance[] = [];

  // ---- Step 1: enumerate companies (cheap) ----
  const companies: Array<{ id: string; name: string }> = [];
  let cursor: string | null = null;
  try {
    do {
      const data: CompanyListPage = await shopifyGraphQL<CompanyListPage>(
        `query($cursor: String) {
          companies(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { id name }
          }
        }`,
        { cursor }
      );
      for (const c of data.companies.nodes) companies.push(c);
      cursor = data.companies.pageInfo.hasNextPage ? data.companies.pageInfo.endCursor : null;
    } while (cursor);
  } catch (e) {
    console.error('[loadRecipients] company enumeration failed:', e);
  }

  // v7.7.9: guarantee known-default companies exist even if enumeration
  // returned empty (Shopify outage, scope revoked, etc).
  const seenIds = new Set(companies.map((c) => c.id));
  for (const gid of KNOWN_T1_COMPANY_GIDS) {
    if (!seenIds.has(gid)) companies.push({ id: gid, name: "Nature's Storehouse" });
  }

  // ---- Step 2: per-company detail (fault-tolerant) ----
  for (const coStub of companies) {
    let co: {
      id: string;
      name: string;
      contacts: { nodes: Array<CompanyContactNode> };
      locations: {
        nodes: Array<{
          id: string;
          name: string;
          catalogs: { nodes: Array<{ id: string; title: string }> };
          roleAssignments: {
            nodes: Array<{ companyContact: CompanyContactNode | null }>;
          };
        }>;
      };
    } = {
      id: coStub.id,
      name: coStub.name,
      contacts: { nodes: [] },
      locations: { nodes: [] },
    };
    try {
      const detail: CompanyDetail = await shopifyGraphQL<CompanyDetail>(
        `query($id: ID!) {
          company(id: $id) {
            id name
            contacts(first: 30) {
              nodes {
                customer {
                  id firstName lastName displayName email
                  emailMarketingConsent { marketingState }
                }
              }
            }
            locations(first: 10) {
              nodes {
                id name
                catalogs(first: 5) { nodes { id title } }
                roleAssignments(first: 20) {
                  nodes {
                    companyContact {
                      customer {
                        id firstName lastName displayName email
                        emailMarketingConsent { marketingState }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        { id: coStub.id }
      );
      if (detail.company) co = detail.company;
    } catch (e) {
      console.error(`[loadRecipients] detail fetch failed for ${coStub.id}:`, e);
    }

    // Tier flags: catalog match UNION fallback UNION built-in known GIDs.
    let coT1 = false;
    let coT2 = false;
    for (const loc of co.locations.nodes) {
      for (const cat of loc.catalogs.nodes) {
        const t = catalogTier(cat.id, cat.title);
        if (t === 't1') coT1 = true;
        if (t === 't2') coT2 = true;
      }
    }
    const fb = companyTierFallback(co.id, co.name);
    coT1 = coT1 || fb.t1 || KNOWN_T1_COMPANY_GIDS.has(co.id);
    coT2 = coT2 || fb.t2 || KNOWN_T2_COMPANY_GIDS.has(co.id);

    // Balance placeholder (v7.7.7 dropped orders selection pending scope).
    const balanceStr = (0).toFixed(2);
    if (coT1) {
      t1Balances.push({
        companyId: co.id,
        companyName: co.name,
        balance: balanceStr,
        adminUrl: shopifyCompanyAdminUrl(co.id),
      });
    }
    if (coT2) {
      t2Balances.push({
        companyId: co.id,
        companyName: co.name,
        balance: balanceStr,
        adminUrl: shopifyCompanyAdminUrl(co.id),
      });
    }

    const mergeCustomer = (cust: CustomerNode | null, t1: boolean, t2: boolean) => {
      if (!cust?.email) return;
      if (!t1 && !t2) return;
      const prior = byCustomer.get(cust.id);
      if (prior) {
        prior.t1 = prior.t1 || t1;
        prior.t2 = prior.t2 || t2;
      } else {
        byCustomer.set(cust.id, { c: cust, companyName: co.name, t1, t2 });
      }
    };

    for (const contact of co.contacts.nodes) {
      mergeCustomer(contact.customer, coT1, coT2);
    }
    for (const loc of co.locations.nodes) {
      let locT1 = false;
      let locT2 = false;
      for (const cat of loc.catalogs.nodes) {
        const t = catalogTier(cat.id, cat.title);
        if (t === 't1') locT1 = true;
        if (t === 't2') locT2 = true;
      }
      const effT1 = locT1 || coT1;
      const effT2 = locT2 || coT2;
      for (const ra of loc.roleAssignments.nodes) {
        mergeCustomer(ra.companyContact?.customer ?? null, effT1, effT2);
      }
    }
  }

  const recipients: Recipient[] = [];
  let suppressedCount = 0;
  for (const { c, companyName, t1, t2 } of byCustomer.values()) {
    const optedOut = (c.emailMarketingConsent?.marketingState ?? '').toUpperCase() !== 'SUBSCRIBED';
    if (optedOut) suppressedCount++;
    recipients.push({
      customerId: c.id,
      email: (c.email ?? '').toLowerCase(),
      displayName:
        c.displayName ||
        [c.firstName, c.lastName].filter(Boolean).join(' ') ||
        c.email ||
        '(unnamed)',
      companyName,
      t1,
      t2,
      optedOut,
    });
  }

  recipients.sort(
    (a, b) => a.companyName.localeCompare(b.companyName) || a.email.localeCompare(b.email)
  );

  const sortBalances = (arr: TierBalance[]) =>
    arr.sort(
      (a, b) => Number(b.balance) - Number(a.balance) || a.companyName.localeCompare(b.companyName)
    );

  const list: RecipientList = {
    recipients,
    suppressedCount,
    tierBalances: { t1: sortBalances(t1Balances), t2: sortBalances(t2Balances) },
  };
  console.log(
    `[loadRecipients] enumerated=${companies.length} recipients=${recipients.length} t1co=${t1Balances.length} t2co=${t2Balances.length} suppressed=${suppressedCount}`
  );
  _recipientCache = { at: Date.now(), data: list };
  return list;
}

/** Bust the recipient cache. Used by admin ops that would race. */
export function invalidateRecipientCache(): void {
  _recipientCache = null;
}
