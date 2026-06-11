import { describe, it, expect } from 'vitest';
import {
  computeCoolerStatus,
  celsiusToFahrenheit,
  defaultRangeForName,
  looksLikeCoolerSensor,
  OUT_OF_RANGE_ALERT_MINUTES,
  type CoolerConfig,
  type CoolerReading,
} from '@/lib/coolers';

const NOW = new Date('2026-06-11T12:00:00Z');

const cfg: CoolerConfig = {
  entity_id: 'sensor.walk_in_cooler_temperature',
  display_name: 'Walk-in Cooler',
  min_f: 32,
  max_f: 41,
  sort_order: 0,
  active: true,
};

/** Build a reading N minutes before NOW. */
function reading(minutesAgo: number, tempF: number): CoolerReading {
  return {
    entity_id: cfg.entity_id,
    temp_f: tempF,
    in_range: tempF >= cfg.min_f && tempF <= cfg.max_f,
    recorded_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  };
}

describe('computeCoolerStatus', () => {
  it('returns no-data when there are no readings', () => {
    const s = computeCoolerStatus(cfg, [], NOW);
    expect(s.state).toBe('no-data');
    expect(s.currentTemp).toBeNull();
  });

  it('returns ok when the latest reading is in range', () => {
    const s = computeCoolerStatus(cfg, [reading(2, 37.5), reading(7, 36.9)], NOW);
    expect(s.state).toBe('ok');
    expect(s.currentTemp).toBe(37.5);
    expect(s.outOfRangeMinutes).toBe(0);
  });

  it('returns warning when out of range for less than the alert threshold', () => {
    // In range 20 min ago, out of range since then
    const s = computeCoolerStatus(
      cfg,
      [reading(2, 44), reading(7, 43.5), reading(12, 42.8), reading(20, 39.0)],
      NOW
    );
    expect(s.state).toBe('warning');
    expect(s.outOfRangeMinutes).toBe(20); // measured from last in-range reading
    expect(s.outOfRangeMinutes).toBeLessThan(OUT_OF_RANGE_ALERT_MINUTES);
  });

  it('returns alert when continuously out of range for 30+ minutes', () => {
    const s = computeCoolerStatus(
      cfg,
      [reading(2, 45), reading(12, 44), reading(22, 43), reading(35, 39.5)],
      NOW
    );
    expect(s.state).toBe('alert');
    expect(s.outOfRangeMinutes).toBe(35);
  });

  it('returns alert when every available reading is out of range and span ≥ 30 min', () => {
    const s = computeCoolerStatus(
      cfg,
      [reading(2, 45), reading(15, 46), reading(31, 47)],
      NOW
    );
    expect(s.state).toBe('alert');
    expect(s.outOfRangeMinutes).toBe(31);
  });

  it('does NOT alert when a brief recovery resets the streak', () => {
    // Out now, but was back in range 10 minutes ago — streak is only 10 min
    const s = computeCoolerStatus(
      cfg,
      [reading(2, 44), reading(10, 38), reading(20, 45), reading(40, 46)],
      NOW
    );
    expect(s.state).toBe('warning');
    expect(s.outOfRangeMinutes).toBe(10);
  });

  it('flags too-cold the same as too-warm (freezing produce is also a loss)', () => {
    const s = computeCoolerStatus(cfg, [reading(2, 28), reading(40, 27)], NOW);
    expect(s.state).toBe('alert');
  });

  it('returns stale when the latest reading is older than the stale threshold', () => {
    const s = computeCoolerStatus(cfg, [reading(45, 37)], NOW);
    expect(s.state).toBe('stale');
    expect(s.currentTemp).toBe(37);
  });

  it('orders recentReadings oldest-first for charting', () => {
    const s = computeCoolerStatus(cfg, [reading(2, 37), reading(12, 36)], NOW);
    expect(new Date(s.recentReadings[0].recorded_at).getTime())
      .toBeLessThan(new Date(s.recentReadings[1].recorded_at).getTime());
  });
});

describe('celsiusToFahrenheit', () => {
  it('converts freezing point', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
  });
  it('converts typical cooler temp', () => {
    expect(celsiusToFahrenheit(3)).toBeCloseTo(37.4, 1);
  });
  it('converts negative freezer temps', () => {
    expect(celsiusToFahrenheit(-18)).toBeCloseTo(-0.4, 1);
  });
});

describe('defaultRangeForName', () => {
  it('uses freezer range when name mentions freezer', () => {
    expect(defaultRangeForName('sensor.chest_freezer_temp').max_f).toBe(5);
  });
  it('uses cooler range otherwise', () => {
    const r = defaultRangeForName('sensor.walk_in_cooler_temp');
    expect(r.min_f).toBe(32);
    expect(r.max_f).toBe(41);
  });
});

describe('looksLikeCoolerSensor', () => {
  it('accepts a cooler temperature sensor', () => {
    expect(looksLikeCoolerSensor('sensor.walk_in_cooler_temperature', 'Walk-in Cooler Temperature', '°F')).toBe(true);
  });
  it('accepts a freezer sensor reporting °C', () => {
    expect(looksLikeCoolerSensor('sensor.freezer_temp', 'Freezer Temp', '°C')).toBe(true);
  });
  it('rejects non-sensor entities', () => {
    expect(looksLikeCoolerSensor('switch.cooler_compressor', 'Cooler Compressor', null)).toBe(false);
  });
  it('rejects humidity sensors on the same device', () => {
    expect(looksLikeCoolerSensor('sensor.walk_in_cooler_humidity', 'Walk-in Cooler Humidity', '%')).toBe(false);
  });
  it('rejects unrelated temperature sensors', () => {
    expect(looksLikeCoolerSensor('sensor.office_temperature', 'Office Temperature', '°F')).toBe(false);
  });
});
