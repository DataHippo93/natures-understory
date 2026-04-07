import { NextResponse } from 'next/server';

// Debug endpoint — shows raw Homebase API response so we can verify the data shape.
// Only accessible when Supabase is not configured (dev) or to admins.
export async function GET() {
  const apiKey = process.env.HOMEBASE_API_KEY;
  const locationId = process.env.HOMEBASE_LOCATION_ID;

  if (!apiKey || !locationId) {
    return NextResponse.json({ error: 'Homebase credentials not configured' }, { status: 500 });
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const [tcRes, shiftRes] = await Promise.all([
    fetch(
      `https://app.joinhomebase.com/api/public/locations/${locationId}/timecards?start_date=${sevenDaysAgo}&end_date=${today}&date_filter=clock_in&page=1&per_page=5`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
    ),
    fetch(
      `https://app.joinhomebase.com/api/public/locations/${locationId}/shifts?start_date=${today}&end_date=${today}&date_filter=start_at&page=1&per_page=5`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
    ),
  ]);

  const tcBody = await tcRes.text();
  const shiftBody = await shiftRes.text();

  return NextResponse.json({
    timecards: {
      status: tcRes.status,
      statusText: tcRes.statusText,
      raw: tcBody.slice(0, 2000),
    },
    shifts: {
      status: shiftRes.status,
      statusText: shiftRes.statusText,
      raw: shiftBody.slice(0, 2000),
    },
    dateRange: { start: sevenDaysAgo, end: today },
    locationId,
  });
}
