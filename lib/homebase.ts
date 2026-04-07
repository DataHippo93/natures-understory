// Homebase labor API client — server-side only
// API docs: https://app.joinhomebase.com/api/public (Bearer token auth)
const HOMEBASE_BASE = 'https://app.joinhomebase.com/api/public';

export interface Timecard {
  id: string;
  date: string; // YYYY-MM-DD (clock_in date in local tz)
  clockedInAt: string; // ISO8601
  clockedOutAt: string; // ISO8601
  regularHours: number;
  overtimeHours: number;
  totalCost: number; // dollars (nominal, not loaded)
  employeeName: string;
}

export interface ScheduledShift {
  id: string;
  date: string; // YYYY-MM-DD (start_at date in local tz)
  startAt: string; // ISO8601
  endAt: string; // ISO8601
  scheduledHours: number;
  scheduledCost: number; // dollars
  employeeName: string;
  department: string;
  wageRate: number;
}

function getCreds() {
  const apiKey = process.env.HOMEBASE_API_KEY;
  const locationId = process.env.HOMEBASE_LOCATION_ID;
  if (!apiKey || !locationId) throw new Error('Homebase credentials not configured');
  return { apiKey, locationId };
}

async function fetchPaginated<T>(
  url: string,
  apiKey: string,
  transform: (item: unknown) => T | null
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;

  while (true) {
    const pageUrl = `${url}&page=${page}&per_page=100`;
    const res = await fetch(pageUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      next: { revalidate: 0 }, // always fresh for real-time labor data
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Homebase API ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    // Homebase returns either an array directly or { data: [...] } or { timecards: [...] } etc.
    let items: unknown[];
    if (Array.isArray(data)) {
      items = data;
    } else if (Array.isArray(data.data)) {
      items = data.data;
    } else if (Array.isArray(data.timecards)) {
      items = data.timecards;
    } else if (Array.isArray(data.shifts)) {
      items = data.shifts;
    } else {
      console.warn('Homebase: unexpected response shape', JSON.stringify(data).slice(0, 200));
      break;
    }

    for (const item of items) {
      const transformed = transform(item);
      if (transformed) results.push(transformed);
    }

    if (items.length < 100) break;
    page++;
  }

  return results;
}

export async function fetchTimecards(startDate: string, endDate: string): Promise<Timecard[]> {
  const { apiKey, locationId } = getCreds();
  const url =
    `${HOMEBASE_BASE}/locations/${locationId}/timecards` +
    `?start_date=${startDate}&end_date=${endDate}&date_filter=clock_in`;

  return fetchPaginated<Timecard>(url, apiKey, (raw) => {
    const r = raw as Record<string, unknown>;
    // Homebase field: clock_in / clock_out (not clocked_in_at)
    if (!r.clock_in || !r.clock_out) return null; // skip open timecards

    const clockIn = String(r.clock_in);
    const clockOut = String(r.clock_out);
    const date = clockIn.slice(0, 10);

    // labor is an object; .costs is a flat dollar number (not a sub-object)
    const labor = r.labor as Record<string, unknown> | undefined;
    const regularHours = Number(labor?.regular_hours ?? 0);
    const paidHours = Number(labor?.paid_hours ?? regularHours);
    const overtimeHours = Math.max(0, paidHours - regularHours);
    const totalCost = Number(labor?.costs ?? 0); // flat dollar amount

    const firstName = String(r.first_name ?? '');
    const lastName = String(r.last_name ?? '');
    const employeeName = `${firstName} ${lastName}`.trim() || 'Unknown';

    return {
      id: String(r.id),
      date,
      clockedInAt: clockIn,
      clockedOutAt: clockOut,
      regularHours: regularHours || computeHours(clockIn, clockOut),
      overtimeHours,
      totalCost,
      employeeName,
    };
  });
}

export async function fetchShifts(startDate: string, endDate: string): Promise<ScheduledShift[]> {
  const { apiKey, locationId } = getCreds();
  const url =
    `${HOMEBASE_BASE}/locations/${locationId}/shifts` +
    `?start_date=${startDate}&end_date=${endDate}&date_filter=start_at`;

  return fetchPaginated<ScheduledShift>(url, apiKey, (raw) => {
    const r = raw as Record<string, unknown>;
    if (!r.start_at || !r.end_at) return null;
    if (r.published === false) return null; // skip unpublished drafts

    const startAt = String(r.start_at);
    const endAt = String(r.end_at);
    const date = startAt.slice(0, 10);

    // labor object may have zero-filled costs when querying across pay periods (Homebase quirk).
    // Fall back to computing from start/end times × wage_rate in that case.
    const labor = r.labor as Record<string, unknown> | undefined;
    const computedHours = computeHours(startAt, endAt);
    const apiHours = Number(labor?.scheduled_hours ?? 0);
    const scheduledHours = apiHours > 0 ? apiHours : computedHours;
    const apiCost = Number(labor?.scheduled_costs ?? 0);
    const wageRate = Number(r.wage_rate ?? 0);
    const scheduledCost = apiCost > 0 ? apiCost : scheduledHours * wageRate;

    const firstName = String(r.first_name ?? '');
    const lastName = String(r.last_name ?? '');
    const employeeName = `${firstName} ${lastName}`.trim() || 'Unknown';

    return {
      id: String(r.id),
      date,
      startAt,
      endAt,
      scheduledHours,
      scheduledCost,
      employeeName,
      department: String(r.department ?? r.role ?? 'General'),
      wageRate,
    };
  });
}

function computeHours(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return Math.max(0, (endMs - startMs) / 3_600_000);
}
