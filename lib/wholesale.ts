// Wholesale pricing data layer — all reads/writes against the LoPro store.
// Server-only. See docs/wholesale_module.md for the B2B model this drives.
//
// Tier model (non-Plus plan — catalogs route through B2B markets):
//   company location → B2B market ("Wholesale Tier 1"/"Tier 2") → catalog → price list
// Env: WHOLESALE_T1_PRICE_LIST_ID, WHOLESALE_T2_PRICE_LIST_ID,
//      WHOLESALE_T1_PUBLICATION_ID, WHOLESALE_T2_PUBLICATION_ID
//
// NOTE (2026-04 API): publishablePublish/Unpublish userErrors have NO `code`
// field — request { field message } only. companyLocation.catalogs is always
// empty on this plan; never rely on it.

import { shopifyGraphQL, assertNoUserErrors } from './shopify-lopro';

export type Tier = 't1' | 't2';

function priceListId(tier: Tier): string {
  const id = tier === 't1' ? process.env.WHOLESALE_T1_PRICE_LIST_ID : process.env.WHOLESALE_T2_PRICE_LIST_ID;
  if (!id) throw new Error(`Missing price list env for ${tier}`);
  return id;
}

function publicationIds(): string[] {
  const t1 = process.env.WHOLESALE_T1_PUBLICATION_ID;
  const t2 = process.env.WHOLESALE_T2_PUBLICATION_ID;
  if (!t1 || !t2) throw new Error('Missing wholesale publication env vars');
  return [t1, t2];
}

export interface GridRow {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  retail: string;
  tier1: string | null; // FIXED price only; null = inherits retail
  tier2: string | null;
  wholesaleActive: boolean;
}

// ---------- Reads ----------

interface ProductsPage {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      title: string;
      metafield: { value: string } | null;
      variants: { nodes: Array<{ id: string; title: string; price: string }> };
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

async function fetchFixedPrices(tier: Tier): Promise<Map<string, string>> {
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
    for (const p of data.priceList.prices.nodes) {
      if (p.originType === 'FIXED') map.set(p.variant.id, p.price.amount);
    }
    cursor = data.priceList.prices.pageInfo.hasNextPage
      ? data.priceList.prices.pageInfo.endCursor
      : null;
  } while (cursor);
  return map;
}

/** Full grid load: every product/variant + retail + both tier fixed prices + toggle. */
export async function loadGrid(): Promise<GridRow[]> {
  const rows: GridRow[] = [];
  const [t1, t2] = await Promise.all([fetchFixedPrices('t1'), fetchFixedPrices('t2')]);

  let cursor: string | null = null;
  do {
    const data: ProductsPage = await shopifyGraphQL<ProductsPage>(
      `query($cursor: String) {
        products(first: 250, after: $cursor, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title
            metafield(namespace: "custom", key: "wholesale_active") { value }
            variants(first: 50) { nodes { id title price } }
          }
        }
      }`,
      { cursor }
    );
    for (const p of data.products.nodes) {
      const active = p.metafield?.value === 'true';
      for (const v of p.variants.nodes) {
        rows.push({
          productId: p.id,
          productTitle: p.title,
          variantId: v.id,
          variantTitle: v.title,
          retail: v.price,
          tier1: t1.get(v.id) ?? null,
          tier2: t2.get(v.id) ?? null,
          wholesaleActive: active,
        });
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return rows;
}

// ---------- Writes ----------

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

/**
 * Toggle a product's wholesale membership.
 * on:  metafield true + publish to both tier publications
 * off: metafield false + unpublish from both + clear its variants' fixed prices
 */
export async function setWholesaleActive(
  productId: string,
  variantIds: string[],
  active: boolean
): Promise<void> {
  const meta = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(
    `mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: productId,
          namespace: 'custom',
          key: 'wholesale_active',
          type: 'boolean',
          value: active ? 'true' : 'false',
        },
      ],
    }
  );
  assertNoUserErrors(meta.metafieldsSet.userErrors, 'setWholesaleActive.metafieldsSet');

  const pubMutation = active ? 'publishablePublish' : 'publishableUnpublish';
  const pub = await shopifyGraphQL<
    Record<string, { userErrors: Array<{ field?: string[]; message: string }> }>
  >(
    `mutation($id: ID!, $input: [PublicationInput!]!) {
      ${pubMutation}(id: $id, input: $input) {
        userErrors { field message }
      }
    }`,
    { id: productId, input: publicationIds().map((publicationId) => ({ publicationId })) }
  );
  assertNoUserErrors(pub[pubMutation].userErrors, `setWholesaleActive.${pubMutation}`);

  if (!active) {
    for (const tier of ['t1', 't2'] as Tier[]) {
      for (const v of variantIds) {
        try {
          await clearTierPrice(tier, v);
        } catch {
          // variant had no fixed price in this list — fine
        }
      }
    }
  }
}

// ---------- Recipients (customer tags) ----------

export interface Recipient {
  customerId: string;
  email: string;
  displayName: string;
  t1: boolean;
  t2: boolean;
}

const TAG: Record<Tier, string> = { t1: 'wholesale-list-t1', t2: 'wholesale-list-t2' };

export async function loadRecipients(): Promise<Recipient[]> {
  const out: Recipient[] = [];
  let cursor: string | null = null;
  do {
    const data: {
      customers: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string; email: string | null; displayName: string; tags: string[] }>;
      };
    } = await shopifyGraphQL(
      `query($cursor: String) {
        customers(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id email displayName tags }
        }
      }`,
      { cursor }
    );
    for (const c of data.customers.nodes) {
      if (!c.email) continue;
      out.push({
        customerId: c.id,
        email: c.email,
        displayName: c.displayName,
        t1: c.tags.includes(TAG.t1),
        t2: c.tags.includes(TAG.t2),
      });
    }
    cursor = data.customers.pageInfo.hasNextPage ? data.customers.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

export async function setRecipientTag(customerId: string, tier: Tier, member: boolean): Promise<void> {
  const mutation = member ? 'tagsAdd' : 'tagsRemove';
  const data = await shopifyGraphQL<
    Record<string, { userErrors: Array<{ field?: string[]; message: string }> }>
  >(
    `mutation($id: ID!, $tags: [String!]!) {
      ${mutation}(id: $id, tags: $tags) { userErrors { field message } }
    }`,
    { id: customerId, tags: [TAG[tier]] }
  );
  assertNoUserErrors(data[mutation].userErrors, `setRecipientTag.${mutation}`);
}
