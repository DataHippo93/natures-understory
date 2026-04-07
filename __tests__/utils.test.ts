import { describe, it, expect } from 'vitest';
import { formatCurrency, formatHour, formatDate, formatDateFull, formatPercent } from '@/lib/utils';

describe('formatCurrency', () => {
  it('formats whole dollar amounts', () => {
    expect(formatCurrency(1000)).toBe('$1,000');
    expect(formatCurrency(0)).toBe('$0');
    expect(formatCurrency(9999.99)).toBe('$10,000');
  });

  it('handles negative values', () => {
    expect(formatCurrency(-500)).toBe('-$500');
  });

  it('handles large values with commas', () => {
    expect(formatCurrency(1234567)).toBe('$1,234,567');
  });
});

describe('formatHour', () => {
  it('formats midnight correctly', () => {
    expect(formatHour(0)).toBe('12am');
    expect(formatHour(24)).toBe('12am');
  });

  it('formats noon correctly', () => {
    expect(formatHour(12)).toBe('12pm');
  });

  it('formats AM hours', () => {
    expect(formatHour(8)).toBe('8am');
    expect(formatHour(11)).toBe('11am');
  });

  it('formats PM hours', () => {
    expect(formatHour(13)).toBe('1pm');
    expect(formatHour(17)).toBe('5pm');
    expect(formatHour(20)).toBe('8pm');
  });
});

describe('formatDate', () => {
  it('formats a date string as Mon DD', () => {
    // Uses local-noon parsing so no timezone shifting
    const result = formatDate('2026-04-06');
    expect(result).toMatch(/Apr\s+6/);
  });

  it('handles different months', () => {
    const result = formatDate('2026-12-25');
    expect(result).toMatch(/Dec\s+25/);
  });

  it('does not shift date due to UTC parsing', () => {
    // This would fail if we parsed as UTC midnight in UTC-5
    const result = formatDate('2026-01-01');
    expect(result).toMatch(/Jan\s+1/);
  });
});

describe('formatPercent', () => {
  it('adds + for positive values', () => {
    expect(formatPercent(5.2)).toBe('+5.2%');
  });

  it('does not add + for negative values', () => {
    expect(formatPercent(-3.1)).toBe('-3.1%');
  });

  it('handles zero', () => {
    expect(formatPercent(0)).toBe('+0.0%');
  });
});
