// Albert's pricelist + invoice CSV parser. Mirrors the Python parser in
// natures-produce-buying/scripts/pull_pricelists.py.
//
// Pricelist format (Albert's CSV):
//   Header rows 0-18 are metadata. Row 19 is the data header:
//     Item Number, Product Description, Size, Prod Type, SC, Price,
//     Availability, UPCPLU, Origin, Pack, PkgSize, UnitCost
//   Empty `prod_type` = certified organic.
//   prod_type 'C' = conventional / natural; 'O2' = 95% organic.
//
// Invoice format (UNFI Invoice CSV):
//   Header: InvoiceNo, CustPO, ItemNumber, MV, BrandName, PkgCount,
//     PkgSize, ProductType, GrossWt, WghtItem, LongDescription, CS,
//     Variety, Pack, Grade, Commodity, UOMDesc, UOMAbbr, Category,
//     UPCPLU, ShipQty, CasePrice, EachPrice, Invoice Date, Country of Origin

export interface PricelistRow {
  sku: string;
  product_desc: string;
  size: string;
  prod_type: string;
  shipper_code: string;
  price: number | null;
  availability: string;
  upc_plu: string;
  origin: string;
  pack: number | null;
  pkg_size: string;
  unit_cost: number | null;
}

export interface InvoiceRow {
  invoice_no: string;
  cust_po: string;
  alberts_sku: string;
  brand_name: string;
  pkg_count: number | null;
  pkg_size: string;
  product_type: string;
  long_desc: string;
  variety: string;
  pack: number | null;
  grade: string;
  commodity: string;
  uom_desc: string;
  uom_abbr: string;
  category: string;
  upc_plu: string;
  ship_qty: number | null;
  case_price: number | null;
  each_price: number | null;
  invoice_date: string | null; // ISO YYYY-MM-DD
  country_of_origin: string;
}

export type ListType = 'fresh' | 'produce';

const PRICELIST_HEADER_ROW = 19;
const PRICELIST_EXPECTED_HEADER = ['Item Number', 'Product Description', 'Size', 'Prod Type'];

/** Parse a CSV-ish string into rows. Handles double-quoted fields with embedded commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(cell); cell = ''; }
      else if (c === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell !== '' || cur.length) {
    cur.push(cell);
    rows.push(cur);
  }
  return rows;
}

function asNumOrNull(s: string): number | null {
  if (!s || !s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedPricelist {
  list_type: ListType;
  rows: PricelistRow[];
  row_count: number;
}

/**
 * Parse an Albert's pricelist CSV. Classifies as 'fresh' or 'produce' by
 * row count (~660 fresh, ~1100 produce). Parser tolerates header offset
 * drift by scanning the first 30 rows for the canonical header.
 */
export function parsePricelist(csvText: string): ParsedPricelist {
  const all = parseCsv(csvText);
  let headerIdx = PRICELIST_HEADER_ROW;
  if (!matchesPricelistHeader(all[headerIdx])) {
    headerIdx = -1;
    for (let i = 0; i < Math.min(30, all.length); i++) {
      if (matchesPricelistHeader(all[i])) { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('Could not locate Albert\'s pricelist header row');
  }
  const header = all[headerIdx].map((h) => h.trim());
  const col = (name: string): number => header.findIndex((h) => h === name);

  const idxSku  = col('Item Number');
  const idxDesc = col('Product Description');
  const idxSize = col('Size');
  const idxPT   = col('Prod Type');
  const idxSC   = col('SC');
  const idxPrice = col('Price');
  const idxAvail = col('Availability');
  const idxUpc   = col('UPCPLU');
  const idxOrigin = col('Origin');
  const idxPack  = col('Pack');
  const idxPkg   = col('PkgSize');
  const idxUnit  = col('UnitCost');

  const rows: PricelistRow[] = [];
  for (let i = headerIdx + 1; i < all.length; i++) {
    const r = all[i];
    if (!r || r.length < 4) continue;
    const sku = (r[idxSku] ?? '').trim();
    if (!sku) continue;
    rows.push({
      sku,
      product_desc: (r[idxDesc] ?? '').trim(),
      size:          (r[idxSize] ?? '').trim(),
      prod_type:     (r[idxPT] ?? '').trim(),
      shipper_code:  (r[idxSC] ?? '').trim(),
      price:         asNumOrNull((r[idxPrice] ?? '').trim()),
      availability:  (r[idxAvail] ?? '').trim(),
      upc_plu:       (r[idxUpc] ?? '').trim(),
      origin:        (r[idxOrigin] ?? '').trim(),
      pack:          (() => { const n = asNumOrNull((r[idxPack] ?? '').trim()); return n != null ? Math.round(n) : null; })(),
      pkg_size:      (r[idxPkg] ?? '').trim(),
      unit_cost:     asNumOrNull((r[idxUnit] ?? '').trim()),
    });
  }
  // Fresh ~660 rows, Produce ~1100. Use 800 as the threshold.
  const list_type: ListType = rows.length > 800 ? 'produce' : 'fresh';
  return { list_type, rows, row_count: rows.length };
}

function matchesPricelistHeader(row: string[] | undefined): boolean {
  if (!row) return false;
  return PRICELIST_EXPECTED_HEADER.every((h, i) => (row[i] ?? '').trim() === h);
}

/**
 * Parse an Albert's invoice CSV (no preamble — header is row 0).
 */
export function parseInvoice(csvText: string): InvoiceRow[] {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (name: string): number => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const i = {
    inv: col('InvoiceNo'),
    custPo: col('CustPO'),
    sku: col('ItemNumber'),
    brand: col('BrandName'),
    pkgCount: col('PkgCount'),
    pkgSize: col('PkgSize'),
    productType: col('ProductType'),
    longDesc: col('LongDescription'),
    variety: col('Variety'),
    pack: col('Pack'),
    grade: col('Grade'),
    commodity: col('Commodity'),
    uomDesc: col('UOMDesc'),
    uomAbbr: col('UOMAbbr'),
    category: col('Category'),
    upc: col('UPCPLU'),
    shipQty: col('ShipQty'),
    casePrice: col('CasePrice'),
    eachPrice: col('EachPrice'),
    invDate: col('Invoice Date'),
    origin: col('Country of Origin'),
  };
  const out: InvoiceRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;
    const sku = (row[i.sku] ?? '').trim();
    if (!sku) continue;
    out.push({
      invoice_no: (row[i.inv] ?? '').trim(),
      cust_po: (row[i.custPo] ?? '').trim(),
      alberts_sku: sku,
      brand_name: (row[i.brand] ?? '').trim(),
      pkg_count: (() => { const n = asNumOrNull((row[i.pkgCount] ?? '').trim()); return n != null ? Math.round(n) : null; })(),
      pkg_size: (row[i.pkgSize] ?? '').trim(),
      product_type: (row[i.productType] ?? '').trim(),
      long_desc: (row[i.longDesc] ?? '').trim(),
      variety: (row[i.variety] ?? '').trim(),
      pack: (() => { const n = asNumOrNull((row[i.pack] ?? '').trim()); return n != null ? Math.round(n) : null; })(),
      grade: (row[i.grade] ?? '').trim(),
      commodity: (row[i.commodity] ?? '').trim(),
      uom_desc: (row[i.uomDesc] ?? '').trim(),
      uom_abbr: (row[i.uomAbbr] ?? '').trim(),
      category: (row[i.category] ?? '').trim(),
      upc_plu: (row[i.upc] ?? '').trim(),
      ship_qty: asNumOrNull((row[i.shipQty] ?? '').trim()),
      case_price: asNumOrNull((row[i.casePrice] ?? '').trim()),
      each_price: asNumOrNull((row[i.eachPrice] ?? '').trim()),
      invoice_date: parseInvoiceDate(row[i.invDate] ?? ''),
      country_of_origin: (row[i.origin] ?? '').trim(),
    });
  }
  return out;
}

function parseInvoiceDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  // Common Albert's formats: "MM/DD/YYYY" or "YYYY-MM-DD"
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (slash) {
    const [, mm, dd, yyyy] = slash;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return iso[0];
  return null;
}

export function sha256Hex(buf: Buffer): string {
  // Keep importable in route handlers (Edge would need WebCrypto; Node runtime is fine here)
  // Lazy-import so this file doesn't pull node:crypto into Edge bundles.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(buf).digest('hex');
}
