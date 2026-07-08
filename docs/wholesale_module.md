# Wholesale Pricing Module (LoPro)

Added 2026-07-07. Spreadsheet-fast wholesale pricing for Daniel Martin (LoPro):
`/wholesale` grid syncing retail + two wholesale tiers straight to Shopify, a
recipients view, and Tier 1/Tier 2 pricelist email generation.

## Data source map (read AGENTS.md first)

- **Source of truth: the LoPro Shopify store** (`0xdj5s-hq.myshopify.com`) —
  no pricing state in Supabase. Variant `price` = retail; fixed prices in two
  price lists = Tier 1/2; product metafield `custom.wholesale_active` = the toggle;
  customer tags `wholesale-list-t1`/`-t2` = pricelist recipients.
- **B2B model (store is NOT Shopify Plus):** direct catalog→company-location
  assignment is Plus-only (API error `UNPERMITTED_ENTITLEMENTS_MARKET_CATALOGS`).
  Tiers route: company location → B2B market ("Wholesale Tier 1"/"Tier 2") →
  catalog → price list. Non-Plus cap: 3 catalogs. `companyLocation.catalogs` is
  always empty on this plan — never rely on it.
- **Auth:** OAuth client credentials grant (Dev Dashboard app "LoPro"), 24h
  tokens, cached + auto-refreshed in `lib/shopify-lopro.ts`. Creds in BWS
  project `natures-storehouse`.

## Live Shopify object IDs (also in Vercel env)

| Object | ID |
|---|---|
| Tier 1 price list | `gid://shopify/PriceList/34822914295` |
| Tier 2 price list | `gid://shopify/PriceList/34823045367` |
| Tier 1 publication | `gid://shopify/Publication/301893583095` |
| Tier 2 publication | `gid://shopify/Publication/301924974839` |
| Tier 1 B2B market | `gid://shopify/Market/95284166903` |
| Tier 2 B2B market | `gid://shopify/Market/95284199671` |

## RBAC

First role-scoped surface in the app. `lib/rbac.ts` reads the authoritative
role from `user_profiles` (service-role client, same as `app/api/admin/*`).
`wholesale_manager` (new `user_role` enum value, migration
`add_wholesale_manager_role` applied 2026-07-07) sees only `/wholesale/*`:

- `proxy.ts` confines wholesale managers to `/wholesale` using the JWT
  `user_metadata.role` (cheap hint only — do not treat as authoritative).
- Every `/api/wholesale/*` route and the page re-check via `lib/rbac.ts`.
- Sidebar shows only the Wholesale section for `wholesale_manager`; admins/gm/agm
  get it appended to the regular nav.

## Onboarding a new wholesale customer

1. Create the Company + location (admin UI or `companyCreate`; `write_companies` granted).
2. Assign the location to the tier's B2B market: admin → Settings → Markets →
   Wholesale Tier N → Includes → add location. (API needs `read/write_markets`,
   which the app token does NOT have yet — scope expansion pending Clark's review.)
3. Customer orders in company-location context → tier price applies.

## Gotchas learned the hard way

- `publishablePublish`/`publishableUnpublish` userErrors have **no `code` field**
  on 2026-04 — request `{ field message }` only.
- `priceListFixedPricesAdd` is add-or-replace; edit == upsert.
- A catalog assigned to a **region market** (e.g. United States) changes RETAIL
  storefront prices — that was the original §8.1 bug. Wholesale catalogs must be
  assigned to the B2B markets only.
- GraphQL cost budget on this store: 2,000 points, 100/s restore.
