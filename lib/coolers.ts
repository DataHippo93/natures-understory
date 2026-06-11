// Cooler temperature monitoring — Home Assistant → Supabase → dashboard.
//
// Data flow:
//   /api/cron/pull-coolers (every 5 min) → fetchHaTemperatures() → cooler_readings
//   /coolers page → getCoolerDashboard() → status per cooler
//
// Env (Vercel): HA_URL, HOME_ASSISTANT_TOKEN (long-lived access token; both in BWS).
import { createAdminClient } from './supabase/admin';

export const OUT_OF_RANGE_ALERT_MINUTES = 30;
export const STALE_READING_MINUTES = 20; // 4 missed 5-min polls = sensor problem

// FDA food-safety defaults used when a sensor is auto-discovered.
export const DEFAULT_COOLER_RANGE = { min_f: 32, max_f: 41 };
export const DEFAULT_FREEZER_RANGE = { min_f: -20, max_f: 5 };

export interface CoolerConfig {
  entity_id: string;
  display_name: string;
  min_f: number;
  max_f: number;
  sort_order: number;
  active: boolean;
}

export interface CoolerReading {
  entity_id: string;
  temp_f: number;
  in_range: boolean;
  recorded_at: string; // ISO
}

export type CoolerState = 'ok' | 'warning' | 'alert' | 'stale' | 'no-data';

export interface CoolerStatus {
  config: CoolerConfig;
  state: CoolerState;
  currentTemp: number | null;
  lastReadingAt: string | null;
  /** Minutes continuously out of range (0 when in range). */
  outOfRangeMinutes: number;
  /** Sparkline data, oldest first. */
  recentReadings: CoolerReading[];
}

// ─── Pure status computation (unit-tested) ──────────────────────────────────

/**
 * Compute a cooler's status from its config and recent readings.
 *
 * Rules:
 *  - no readings at all                         → 'no-data'
 *  - latest reading older than STALE minutes    → 'stale' (sensor problem)
 *  - latest in range                            → 'ok'
 *  - out of range < ALERT minutes               → 'warning' (excursion, may be a door open / defrost)
 *  - continuously out of range ≥ ALERT minutes  → 'alert' (flagged)
 *
 * "Continuously out of range" is measured from the last in-range reading.
 * If every available reading is out of range, the streak starts at the
 * oldest available reading.
 */
export function computeCoolerStatus(
  config: CoolerConfig,
  readingsNewestFirst: CoolerReading[],
  now: Date = new Date()
): CoolerStatus {
  const recentReadings = [...readingsNewestFirst].reverse();
  const latest = readingsNewestFirst[0] ?? null;

  if (!latest) {
    return {
      config,
      state: 'no-data',
      currentTemp: null,
      lastReadingAt: null,
      outOfRangeMinutes: 0,
      recentReadings,
    };
  }

  const minutesSinceLatest = (now.getTime() - new Date(latest.recorded_at).getTime()) / 60_000;
  if (minutesSinceLatest > STALE_READING_MINUTES) {
    return {
      config,
      state: 'stale',
      currentTemp: latest.temp_f,
      lastReadingAt: latest.recorded_at,
      outOfRangeMinutes: 0,
      recentReadings,
    };
  }

  if (latest.in_range) {
    return {
      config,
      state: 'ok',
      currentTemp: latest.temp_f,
      lastReadingAt: latest.recorded_at,
      outOfRangeMinutes: 0,
      recentReadings,
    };
  }

  // Out of range: find when the current excursion started.
  const lastOk = readingsNewestFirst.find((r) => r.in_range) ?? null;
  const streakStartMs = lastOk
    ? new Date(lastOk.recorded_at).getTime()
    : new Date(readingsNewestFirst[readingsNewestFirst.length - 1].recorded_at).getTime();
  const outOfRangeMinutes = Math.max(0, Math.round((now.getTime() - streakStartMs) / 60_000));

  return {
    config,
    state: outOfRangeMinutes >= OUT_OF_RANGE_ALERT_MINUTES ? 'alert' : 'warning',
    currentTemp: latest.temp_f,
    lastReadingAt: latest.recorded_at,
    outOfRangeMinutes,
    recentReadings,
  };
}

/** °C → °F, rounded to 0.01. */
export function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 100) / 100;
}

/** Default range based on the entity/friendly name. */
export function defaultRangeForName(name: string): { min_f: number; max_f: number } {
  return /freez/i.test(name) ? DEFAULT_FREEZER_RANGE : DEFAULT_COOLER_RANGE;
}

/** Heuristic: does this HA entity look like a cooler/freezer temperature sensor? */
export function looksLikeCoolerSensor(entityId: string, friendlyName: string, unit: string | null): boolean {
  if (!entityId.startsWith('sensor.')) return false;
  if (unit && !/°?[FC]$/i.test(unit.trim())) return false;
  const hay = `${entityId} ${friendlyName}`.toLowerCase();
  return /(cooler|freezer|fridge|refrigerat|walk[\s_-]?in|produce case|dairy case|deli case)/.test(hay)
    && /(temp|°)/.test(`${hay} ${unit ?? ''}`.toLowerCase());
}

// ─── Home Assistant fetch ────────────────────────────────────────────────────

interface HaState {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    device_class?: string;
  };
}

export interface HaTemperature {
  entity_id: string;
  friendly_name: string;
  temp_f: number;
}

function haCreds() {
  const url = process.env.HA_URL?.replace(/\/+$/, '');
  const token = process.env.HOME_ASSISTANT_TOKEN;
  if (!url || !token) throw new Error('HA_URL / HOME_ASSISTANT_TOKEN not configured');
  return { url, token };
}

/** Fetch all temperature-looking states from Home Assistant, normalized to °F. */
export async function fetchHaTemperatures(): Promise<HaTemperature[]> {
  const { url, token } = haCreds();
  const res = await fetch(`${url}/api/states`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Home Assistant ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const states = (await res.json()) as HaState[];
  const out: HaTemperature[] = [];

  for (const s of states) {
    const unit = s.attributes.unit_of_measurement ?? null;
    const friendly = s.attributes.friendly_name ?? s.entity_id;
    const value = parseFloat(s.state);
    if (!Number.isFinite(value)) continue; // 'unavailable', 'unknown'
    if (!looksLikeCoolerSensor(s.entity_id, friendly, unit)) continue;

    const tempF = unit && /c$/i.test(unit.replace('°', '').trim()) ? celsiusToFahrenheit(value) : value;
    out.push({ entity_id: s.entity_id, friendly_name: friendly, temp_f: Math.round(tempF * 100) / 100 });
  }

  return out;
}

// ─── Sync (called by the cron route) ────────────────────────────────────────

export interface CoolerSyncResult {
  sensorsSeen: number;
  readingsWritten: number;
  newlyDiscovered: string[];
}

export async function syncCoolerReadings(): Promise<CoolerSyncResult> {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase admin client not configured');

  const temps = await fetchHaTemperatures();

  const { data: configRows, error: cfgErr } = await admin.from('cooler_config').select('*');
  if (cfgErr) throw new Error(`cooler_config read: ${cfgErr.message}`);
  const configs = new Map((configRows ?? []).map((c) => [c.entity_id, c as CoolerConfig & { active: boolean }]));

  // Auto-register sensors we haven't seen before, with sensible default ranges.
  const newlyDiscovered: string[] = [];
  for (const t of temps) {
    if (configs.has(t.entity_id)) continue;
    const range = defaultRangeForName(`${t.entity_id} ${t.friendly_name}`);
    const row = {
      entity_id: t.entity_id,
      display_name: t.friendly_name,
      min_f: range.min_f,
      max_f: range.max_f,
      sort_order: 100,
      active: true,
      auto_discovered: true,
    };
    const { error } = await admin.from('cooler_config').insert(row);
    if (!error) {
      configs.set(t.entity_id, row as unknown as CoolerConfig & { active: boolean });
      newlyDiscovered.push(t.entity_id);
    }
  }

  // Write one reading per active configured sensor.
  const readings = temps
    .filter((t) => configs.get(t.entity_id)?.active)
    .map((t) => {
      const cfg = configs.get(t.entity_id)!;
      return {
        entity_id: t.entity_id,
        temp_f: t.temp_f,
        in_range: t.temp_f >= Number(cfg.min_f) && t.temp_f <= Number(cfg.max_f),
        recorded_at: new Date().toISOString(),
      };
    });

  if (readings.length > 0) {
    const { error } = await admin.from('cooler_readings').insert(readings);
    if (error) throw new Error(`cooler_readings insert: ${error.message}`);
  }

  return { sensorsSeen: temps.length, readingsWritten: readings.length, newlyDiscovered };
}

// ─── Dashboard read ──────────────────────────────────────────────────────────

export async function getCoolerDashboard(): Promise<CoolerStatus[]> {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supabase admin client not configured');

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [cfgRes, readRes] = await Promise.all([
    admin.from('cooler_config').select('*').eq('active', true).order('sort_order').order('display_name'),
    admin
      .from('cooler_readings')
      .select('entity_id, temp_f, in_range, recorded_at')
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: false })
      .limit(5000),
  ]);

  if (cfgRes.error) throw new Error(`cooler_config: ${cfgRes.error.message}`);
  if (readRes.error) throw new Error(`cooler_readings: ${readRes.error.message}`);

  const byEntity = new Map<string, CoolerReading[]>();
  for (const r of (readRes.data ?? []) as Array<CoolerReading & { temp_f: unknown; in_range: boolean }>) {
    const arr = byEntity.get(r.entity_id) ?? [];
    arr.push({ ...r, temp_f: Number(r.temp_f) });
    byEntity.set(r.entity_id, arr);
  }

  return ((cfgRes.data ?? []) as CoolerConfig[]).map((cfg) =>
    computeCoolerStatus(
      { ...cfg, min_f: Number(cfg.min_f), max_f: Number(cfg.max_f) },
      byEntity.get(cfg.entity_id) ?? []
    )
  );
}
