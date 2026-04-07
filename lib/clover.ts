// Clover POS API client — server-side only (uses private env vars)
const CLOVER_BASE = 'https://api.clover.com/v3/merchants';
const LOCAL_TZ = 'America/New_York';

export interface CloverPayment {
  id: string;
  createdTime: number; // ms epoch UTC
  amount: number; // cents
  result: string;
  refunds?: { elements: Array<{ amount: number }> };
}

function getCreds() {
  const mid = process.env.NATURES_STOREHOUSE_MID;
  const token = process.env.NATURES_STOREHOUSE_TOKEN;
  if (!mid || !token) throw new Error('Clover credentials not configured');
  return { mid, token };
}

export async function fetchPayments(startMs: number, endMs: number): Promise<CloverPayment[]> {
  const { mid, token } = getCreds();
  const payments: CloverPayment[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const params = new URLSearchParams();
    params.append('filter', `createdTime>=${startMs}`);
    params.append('filter', `createdTime<${endMs}`);
    params.append('expand', 'refunds');
    params.append('limit', String(limit));
    params.append('offset', String(offset));
    params.append('orderBy', 'createdTime ASC');

    const res = await fetch(`${CLOVER_BASE}/${mid}/payments?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`Clover API ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const elements: CloverPayment[] = data.elements ?? [];
    payments.push(...elements.filter((p) => p.result === 'SUCCESS'));
    if (elements.length < limit) break;
    offset += limit;
  }

  return payments;
}

/** Net sales in dollars (amount minus refunds) */
export function netSalesDollars(p: CloverPayment): number {
  const refunds = (p.refunds?.elements ?? []).reduce((s, r) => s + r.amount, 0);
  return (p.amount - refunds) / 100;
}

/** YYYY-MM-DD in local timezone */
export function localDateStr(epochMs: number, tz = LOCAL_TZ): string {
  return new Date(epochMs).toLocaleDateString('en-CA', { timeZone: tz });
}

/** Hour 0-23 in local timezone */
export function localHour(epochMs: number, tz = LOCAL_TZ): number {
  return parseInt(
    new Date(epochMs).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }),
    10
  );
}

/** Day of week 0=Sun..6=Sat in local timezone */
export function localDayOfWeek(epochMs: number, tz = LOCAL_TZ): number {
  const dateStr = localDateStr(epochMs, tz);
  return new Date(dateStr + 'T12:00:00').getDay();
}

/** Midnight local time for today, returned as epoch ms */
export function todayMidnightMs(tz = LOCAL_TZ): number {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  return new Date(todayStr + 'T00:00:00' + tzOffsetString(tz)).getTime();
}

/** Midnight for N days ago */
export function nDaysAgoMidnightMs(n: number, tz = LOCAL_TZ): number {
  const date = new Date();
  date.setDate(date.getDate() - n);
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: tz });
  return new Date(dateStr + 'T00:00:00' + tzOffsetString(tz)).getTime();
}

/** Midnight for N days from now */
export function nDaysFromNowMidnightMs(n: number, tz = LOCAL_TZ): number {
  const date = new Date();
  date.setDate(date.getDate() + n);
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: tz });
  return new Date(dateStr + 'T00:00:00' + tzOffsetString(tz)).getTime();
}

export interface CloverCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface CloverItem {
  id: string;
  name: string;
  price: number; // cents
  categories: CloverCategory[];
  hidden?: boolean;
  deleted?: boolean;
}

export interface CloverLineItem {
  id: string;
  orderId: string;
  name: string;
  price: number; // cents
  unitQty?: number;
  quantity?: number; // alias
  discountAmount?: number; // cents
  refunded?: boolean;
  item?: { id: string };
  createdTime: number; // ms epoch
}

export interface CloverOrder {
  id: string;
  createdTime: number;
  lineItems?: { elements: CloverLineItem[] };
}

export async function fetchCategories(): Promise<CloverCategory[]> {
  const { mid, token } = getCreds();
  const res = await fetch(
    `${CLOVER_BASE}/${mid}/categories?limit=1000&orderBy=sortOrder`,
    { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 3600 } }
  );
  if (!res.ok) throw new Error(`Clover categories ${res.status}`);
  const data = await res.json();
  return (data.elements ?? []).map((c: Record<string, unknown>) => ({
    id: String(c.id),
    name: String(c.name ?? ''),
    sortOrder: Number(c.sortOrder ?? 0),
  }));
}

export async function fetchItems(): Promise<CloverItem[]> {
  const { mid, token } = getCreds();
  const items: CloverItem[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await fetch(
      `${CLOVER_BASE}/${mid}/items?limit=${limit}&offset=${offset}&expand=categories&filter=hidden=false`,
      { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 3600 } }
    );
    if (!res.ok) throw new Error(`Clover items ${res.status}`);
    const data = await res.json();
    const elements = data.elements ?? [];
    for (const el of elements) {
      if (el.deleted) continue;
      items.push({
        id: String(el.id),
        name: String(el.name ?? ''),
        price: Number(el.price ?? 0),
        categories: (el.categories?.elements ?? []).map((c: Record<string, unknown>) => ({
          id: String(c.id),
          name: String(c.name ?? ''),
          sortOrder: Number(c.sortOrder ?? 0),
        })),
        hidden: Boolean(el.hidden),
        deleted: Boolean(el.deleted),
      });
    }
    if (elements.length < limit) break;
    offset += limit;
  }
  return items;
}

export async function fetchOrdersWithLineItems(startMs: number, endMs: number): Promise<CloverOrder[]> {
  const { mid, token } = getCreds();
  const orders: CloverOrder[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams();
    params.append('filter', `createdTime>=${startMs}`);
    params.append('filter', `createdTime<${endMs}`);
    params.append('expand', 'lineItems');
    params.append('limit', String(limit));
    params.append('offset', String(offset));
    params.append('orderBy', 'createdTime ASC');

    const res = await fetch(`${CLOVER_BASE}/${mid}/orders?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`Clover orders ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const elements = data.elements ?? [];
    orders.push(...elements);
    if (elements.length < limit) break;
    offset += limit;
  }
  return orders;
}

// Simple UTC offset string for America/New_York (-05:00 or -04:00)
function tzOffsetString(tz: string): string {
  if (tz !== 'America/New_York') return 'Z';
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(
    -jan.getTimezoneOffset(),
    -jul.getTimezoneOffset()
  );
  // Determine if currently DST
  const isDST = -now.getTimezoneOffset() !== stdOffset;
  return isDST ? '-04:00' : '-05:00';
}
