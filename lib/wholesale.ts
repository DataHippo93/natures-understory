// Wholesale pricing data layer — LoPro store. Server-only.
//
// Tier model (non-Plus plan — catalogs route through B2B markets):
//   Company Location → B2B market → catalog → price list
// Env: WHOLESALE_T1_PRICE_LIST_ID, WHOLESALE_T2_PRICE_LIST_ID
// Optional env: WHOLESALE_T1_CATALOG_ID, WHOLESALE_T2_CATALOG_ID
//   (for recipient tier mapping; falls back to title match on "Tier 1"/"Tier 2")
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

import { shopifyGraphQL, assertNoUserErrors } from './shopify-lopro';

export type Tier = 't1' | 't2';

function priceListId(tier: Tier): string {
  const id = tier === 't1' ? process.env.WHOLESALE_T1_PRICE_LIST_ID : process.env.WHOLESALE_T2_PRICE_LIST_ID;
  if (!id) throw new Error(`Missing price list env for ${tier}`);
  return id;
}

function catalogTier(catalogId: string, catalogTitle: string): Tier | null {
  const t1id = process.env.WHOLESALE_T1_CATALOG_ID;
  const t2id = process.env.WHOLESALE_T2_CATALOG_ID;
  if (t1id && catalogId === t1id) return 't1';
  if (t2id && catalogId === t2id) return 't2';
  const t = catalogTitle.toLowerCase();
  if (t.includes('tier 1') || t.endsWith(' t1')) return 't1';
  if (t.includes('tier 2') || t.endsWith(' t2')) return 't2';
  return null;
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
        });
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return rows;
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

/** Upsert a tier fixed price (priceListFixedPricesAdd = add-or-replace). */
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

// ---------- Toggle (v7.4: variant-level) ----------

/**
 * Toggle a single variant's wholesale_active metafield.
 * on:  variant metafield -> 'true'
 * off: variant metafield -> 'false' + clear any fixed tier overrides on that variant
 *
 * Product visibility in each tier catalog is managed in Shopify Admin
 * (Product → Publishing → LoPro Wholesale Tier N). Not touched here — the
 * previous product-level publish/unpublish path pointed at publication IDs
 * that no longer exist on this store.
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

  if (!active) {
    for (const tier of ['t1', 't2'] as Tier[]) {
      try {
        await clearTierPrice(tier, variantId);
      } catch {
        // variant had no fixed override in this list — fine
      }
    }
  }
}

// ---------- Recipients (v7.4: auto from B2B Companies) ----------

export interface Recipient {
  customerId: string;
  email: string;
  displayName: string;
  companyName: string;
  t1: boolean;
  t2: boolean;
  optedOut: boolean; // marketingState !== 'SUBSCRIBED'
}

export interface RecipientList {
  recipients: Recipient[]; // includes opted-out (client filters); sorted by company then email
  suppressedCount: number; // opted-out count for the UI hint
}

interface CustomerNode {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  emailMarketingConsent: { marketingState: string } | null;
}

interface CompaniesPage {
  companies: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      name: string;
      locations: {
        nodes: Array<{
          id: string;
          name: string;
          catalogs: { nodes: Array<{ id: string; title: string }> };
          roleAssignments: {
            nodes: Array<{
              companyContact: { customer: CustomerNode | null } | null;
            }>;
          };
        }>;
      };
    }>;
  };
}

let _recipientCache: { at: number; data: RecipientList } | null = null;
const RECIPIENT_TTL_MS = 10 * 60 * 1000;

/** Companies → Locations → catalog → Tier, joined with each Location's Company Contacts.
 *  Memoized 10 min.
 *  v7.7.2: page sizes trimmed (companies 50->25, locations 20->10,
 *  roleAssignments 50->20) to stay under Shopify's 1000-point cost cap. */
export async function loadRecipients(): Promise<RecipientList> {
  if (_recipientCache && Date.now() - _recipientCache.at < RECIPIENT_TTL_MS) {
    return _recipientCache.data;
  }

  const byCustomer = new Map<
    string,
    { c: CustomerNode; companyName: string; t1: boolean; t2: boolean }
  >();

  let cursor: string | null = null;
  do {
    const data: CompaniesPage = await shopifyGraphQL<CompaniesPage>(
      `query($cursor: String) {
        companies(first: 25, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id name
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
        }
      }`,
      { cursor }
    );

    for (const co of data.companies.nodes) {
      for (const loc of co.locations.nodes) {
        let locT1 = false;
        let locT2 = false;
        for (const cat of loc.catalogs.nodes) {
          const t = catalogTier(cat.id, cat.title);
          if (t === 't1') locT1 = true;
          if (t === 't2') locT2 = true;
        }
        if (!locT1 && !locT2) continue;

        for (const ra of loc.roleAssignments.nodes) {
          const cust = ra.companyContact?.customer;
          if (!cust?.email) continue;
          const prior = byCustomer.get(cust.id);
          if (prior) {
            prior.t1 = prior.t1 || locT1;
            prior.t2 = prior.t2 || locT2;
          } else {
            byCustomer.set(cust.id, { c: cust, companyName: co.name, t1: locT1, t2: locT2 });
          }
        }
      }
    }
    cursor = data.companies.pageInfo.hasNextPage ? data.companies.pageInfo.endCursor : null;
  } while (cursor);

  const recipients: Recipient[] = [];
  let suppressedCount = 0;
  for (const { c, companyName, t1, t2 } of byCustomer.values()) {
    const optedOut = (c.emailMarketingConsent?.marketingState ?? '') !== 'SUBSCRIBED';
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

  const list: RecipientList = { recipients, suppressedCount };
  _recipientCache = { at: Date.now(), data: list };
  return list;
}

/** Bust the 10-min recipient cache. Used by admin ops that would race. */
export function invalidateRecipientCache(): void {
  _recipientCache = null;
}

