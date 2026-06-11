# Order Pipeline API Contract

The Cowork agent owns the conversational + OCR layer. The Vercel app
owns deterministic logic + persistence. This is the boundary.

## Auth

All `/api/orders/*` and `/api/cron/*` routes accept a `Bearer` token via
the `Authorization` header. Two acceptable secrets:

| Header | Used by |
|---|---|
| `Bearer ${CRON_SECRET}` | Vercel Cron (set automatically) |
| `Bearer ${AGENT_SECRET}` | Cowork agent calls and any other client |

Set both as Vercel env vars (different values).

## Endpoints

### `POST /api/orders/build`

Build a draft order from a normalized list.

**Request body:**

```json
{
  "order_date": "2026-04-30",
  "ref_pricelist_date": "2026-04-30",
  "rehearsal": false,
  "lines": [
    {
      "raw_text": "scallions",
      "name": "scallions",
      "qty": 1,
      "notes": null
    },
    {
      "raw_text": "smart chicken thighs S/O for Rainbow",
      "name": "smart chicken thighs",
      "qty": 1,
      "so_customer": "Rainbow",
      "so_phone": null,
      "notes": "S/O"
    },
    {
      "raw_text": "yukon gold potatoes",
      "name": "yukon gold potatoes",
      "qty": 1,
      "pinned_sku": "37151"
    }
  ]
}
```

Field semantics:

- `order_date` — store-local YYYY-MM-DD. Used as PK on `alberts_orders`.
- `ref_pricelist_date` — which `alberts_price_entries` snapshot to match
  against. Almost always equal to `order_date`.
- `rehearsal` — true means "don't side-effect; for testing." Currently
  the only effect is the decision_log run_label being `rehearsal` rather
  than `morning_draft`.
- `lines[].name` — normalized name (lowercase, no inflection) used for
  fuzzy match against `product_desc` on the pricelist.
- `lines[].pinned_sku` — bypass fuzzy match; require this exact SKU.
- `lines[].so_customer` / `so_phone` — special-order metadata. Goes into
  the line's `internal_po` notes; does NOT appear in the supplier email.

**Response:**

```json
{
  "ok": true,
  "order_date": "2026-04-30",
  "n_lines": 28,
  "subtotal_cents": 159651,
  "subtotal_if_bids_cents": 155931,
  "open_questions": ["No pricelist match for \"avocados\""],
  "availability_flags": [],
  "conv_unavoidable": ["smart chicken thighs 45447 — no in-stock organic on today's list"],
  "added_per_clark": [],
  "dropped": ["Cauliflower 12280 — Due Tuesday won't make 4 AM Tue truck"],
  "decisions": [
    {
      "sku": "14677",
      "item_name": "scallions",
      "description": "Onions, Green (Scallions)",
      "qty": 1,
      "bid_price": null,
      "supplier_note": "1 case",
      "internal_po": "have 0 on hand (conf 0.92)"
    }
  ]
}
```

**Side effects:**

- Upserts row in `alberts_orders` (PK = `order_date`).
- Replaces all rows in `alberts_order_lines` for that `order_date`.
- Inserts one row per Decision into `decision_log`.

### `GET /api/orders/[date]/email`

Returns the cached `.eml` for that order. 404 if not yet rendered.

**Headers:**
- `Content-Type: message/rfc822`
- `Content-Disposition: attachment; filename="order_for_..."`

### `POST /api/orders/[date]/po`

Create a draft Thrive PO from the saved order.

**Currently 503-gated** until Task #2 (Thrive PO POST capture) lands and
the operator sets `THRIVE_PO_PATH_VERIFIED=1`. See route file for details.

### `POST /api/cron/pull-pricelists` (Mon/Thu 6:50 AM ET)

Pull Jasmia's pricelist emails and ingest. Idempotent.

Query params:
- `?date=YYYY-MM-DD` — override target date (default = today)
- `?dry=1` — parse but don't write

### `POST /api/cron/pull-invoice` (Mon/Thu */20 21-23 ET, */20 0-3 next-day ET)

Watch for the order day's invoice. Returns `no_invoice_yet: true` if
nothing's arrived yet — that's the expected case until the truck closes.

### `POST /api/cron/compute-features` (nightly 3 AM ET)

Rebuild `seasonal_index` + `elasticity_hint`. Marks rows
`insufficient_data=true` until enough history is in.

### `POST /api/cron/pull-inventory` (Mon/Thu 6:55 AM ET)

**Currently 503-gated** until Task #5 lands. See route file.

## Cowork agent integration sketch

```
User drops handwritten photo
  ↓
Cowork agent OCRs → normalizes → builds OrderInput JSON
  ↓
agent calls POST /api/orders/build
  ↓
Vercel returns BuildResult with decisions, exceptions
  ↓
agent shows the result to user; iterates ("drop cauliflower", "1/2 case onions")
  ↓
each iteration → agent re-POSTs /api/orders/build
  ↓
when user approves: agent renders .eml from /api/orders/[date]/email
  ↓
user uploads .eml to Gmail and sends
  ↓
that night: cron pulls invoice, marks order as 'received'
  ↓
once Task #2 unblocks: agent POSTs /api/orders/[date]/po → Thrive PO created
```

Cowork agent stays the dialogue surface; Vercel owns the deterministic
matching, scoring, persistence, and exception detection.
