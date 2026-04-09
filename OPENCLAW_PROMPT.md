# OpenClaw Nightly Sync — Clover Category Sales → Supabase

Run this every night at **2:00 AM Eastern** (after the store closes).

---

## What to fetch from Clover

**Merchant ID:** `A4KR93XCQVW11`  
**API token:** use the stored credential `NATURES_STOREHOUSE_TOKEN`  
**Base URL:** `https://api.clover.com/v3/merchants/A4KR93XCQVW11`

Fetch **all orders for yesterday** (midnight-to-midnight Eastern time, i.e. `createdTime >= <yesterday 00:00 ET in epoch ms>` and `createdTime < <today 00:00 ET in epoch ms>`).

For each order, expand line items **and** their item categories:

```
GET /orders
  ?filter=createdTime>=<startMs>
  &filter=createdTime<<endMs>
  &expand=lineItems,lineItems.item,lineItems.item.categories
  &limit=100
  &offset=<page offset>
  &orderBy=createdTime ASC
```

Paginate until `elements.length < 100`. Collect every line item from every order.

---

## How to transform each line item

For each `lineItem` in `order.lineItems.elements`:

| Field | Source |
|---|---|
| `id` | `lineItem.id` |
| `order_id` | `order.id` |
| `item_id` | `lineItem.item.id` (nullable) |
| `item_name` | `lineItem.name` |
| `category_id` | `lineItem.item.categories.elements[0].id` (nullable) |
| `category_name` | `lineItem.item.categories.elements[0].name` (nullable) |
| `quantity` | If `lineItem.unitQty` exists: `round(unitQty / 1000, 3)`. Otherwise `lineItem.quantity ?? 1` |
| `unit_price_cents` | `lineItem.price ?? 0` |
| `discount_cents` | `lineItem.discountAmount ?? 0` |
| `net_price_cents` | `max(0, round(unit_price_cents * quantity) - discount_cents)` |
| `sale_date` | `lineItem.createdTime` (or `order.createdTime`) converted to `YYYY-MM-DD` in **America/New_York** |
| `sale_hour` | Hour 0–23 of that timestamp in **America/New_York** |
| `sale_ts` | ISO8601 UTC string of the timestamp |
| `pos_source` | `"clover"` (hardcoded string) |

**Skip** any line item where `lineItem.refunded === true`.

---

## Where to write in Supabase

**Supabase project:** `yvbsibrikylbqupignij`  
**Supabase URL:** `https://yvbsibrikylbqupignij.supabase.co`  
**Table:** `sales_line_items`  
**Auth:** use the stored service role key `SUPABASE_SERVICE_ROLE_KEY`

Upsert rows (conflict on `id` column — update all fields on conflict):

```sql
INSERT INTO sales_line_items (
  id, order_id, item_id, item_name,
  category_id, category_name,
  quantity, unit_price_cents, discount_cents, net_price_cents,
  sale_date, sale_hour, sale_ts, pos_source
) VALUES (...)
ON CONFLICT (id) DO UPDATE SET
  category_id    = EXCLUDED.category_id,
  category_name  = EXCLUDED.category_name,
  quantity       = EXCLUDED.quantity,
  net_price_cents = EXCLUDED.net_price_cents,
  sale_date      = EXCLUDED.sale_date,
  sale_hour      = EXCLUDED.sale_hour,
  sale_ts        = EXCLUDED.sale_ts;
```

Batch in groups of **500 rows** per insert call.

---

## Also sync the items catalog (run once per night before the orders sync)

This ensures `category_name` is populated even for line items where the API doesn't embed categories inline.

```
GET /items?limit=1000&offset=<page>&expand=categories&filter=hidden=false
```

Paginate until `elements.length < 1000`. Skip items where `deleted === true`.

Upsert into `sales_items`:

| Column | Source |
|---|---|
| `id` | `item.id` |
| `name` | `item.name` |
| `price_cents` | `item.price` |
| `category_id` | `item.categories.elements[0].id` (nullable) |
| `category_name` | `item.categories.elements[0].name` (nullable) |

Conflict on `id`, update all fields.

---

## Success log

After a successful run, insert one row into `sync_log`:

```json
{
  "sync_type": "clover_nightly",
  "date_range_start": "<yesterday YYYY-MM-DD>",
  "date_range_end": "<yesterday YYYY-MM-DD>",
  "completed_at": "<now ISO8601>",
  "records_synced": <total line items upserted>
}
```

If the run fails, still insert a row with `"error": "<error message>"`.
