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

// ---------- Recipients (v7.4: auto from B2B Companies; v7.7.5: contacts + balances) ----------

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

// v7.7.7: OrderNode kept as never (company.orders removed pending
// read_orders scope on the LoPro app).
type OrderNode = never;

interface CompaniesPage {
  companies: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      name: string;
      // v7.7.5: contacts at Company scope catches recipients who are
      // Company Contacts but haven't been role-assigned to a specific
      // location. The old `location.roleAssignments` -only traversal
      // dropped them.
      contacts: { nodes: Array<CompanyContactNode> };
      // v7.7.7: outstanding balances disabled pending read_orders scope
      // on LoPro app.
      locations: {
        nodes: Array<{
          id: string;
          name: string;
          catalogs: { nodes: Array<{ id: string; title: string }> };
          roleAssignments: {
            nodes: Array<{
              companyContact: CompanyContactNode | null;
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
 *  roleAssignments 50->20) to stay under Shopify's 1000-point cost cap.
 *  v7.7.5: also walks `company.contacts` and `company.orders` (for tier
 *  balance summaries). Companies inherit tier flags from the UNION of their
 *  locations' tier catalog assignments — a Company Contact who can shop at
 *  ANY tier-1 location is a valid tier-1 pricelist recipient. */
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

  let cursor: string | null = null;
  do {
    const data: CompaniesPage = await shopifyGraphQL<CompaniesPage>(
      `query($cursor: String) {
        companies(first: 25, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
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
        }
      }`,
      { cursor }
    );

    for (const co of data.companies.nodes) {
      // Company-level tier flags: union of all locations' tier catalog
      // assignments. If ANY location has the Tier N catalog, we consider
      // this company a Tier N wholesale account.
      let coT1 = false;
      let coT2 = false;
      for (const loc of co.locations.nodes) {
        for (const cat of loc.catalogs.nodes) {
          const t = catalogTier(cat.id, cat.title);
          if (t === 't1') coT1 = true;
          if (t === 't2') coT2 = true;
        }
      }

      // Sum outstanding balance across this company's unpaid orders.
      // presentmentMoney is a decimal string ("432.10"); parse -> Number for
      // summation, then toFixed(2) for a stable decimal-string output.
      // v7.7.7: balance always 0 pending read_orders scope on LoPro app.
      const balance = 0;
      const balanceStr = balance.toFixed(2);
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

      // Recipients: union of (a) `company.contacts` and (b) each location's
      // `roleAssignments.companyContact.customer`. Company Contacts get the
      // company-wide tier flags; role-assigned contacts get the specific
      // location's tier flags (which can be narrower than company-wide if
      // catalogs vary between locations — rare, but supported).
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
        // Fall back to company-wide flags if the location has no explicit
        // catalog assignment but the company does — this catches setups
        // where catalogs are attached to Company scope rather than per
        // Location. Belt-and-suspenders for hypothesis D.
        const effT1 = locT1 || coT1;
        const effT2 = locT2 || coT2;
        for (const ra of loc.roleAssignments.nodes) {
          mergeCustomer(ra.companyContact?.customer ?? null, effT1, effT2);
        }
      }
    }
    cursor = data.companies.pageInfo.hasNextPage ? data.companies.pageInfo.endCursor : null;
  } while (cursor);

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
  _recipientCache = { at: Date.now(), data: list };
  return list;
}

/** Bust the 10-min recipient cache. Used by admin ops that would race. */
export function invalidateRecipientCache(): void {
  _recipientCache = null;
}
