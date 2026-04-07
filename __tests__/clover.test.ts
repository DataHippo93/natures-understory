import { describe, it, expect } from 'vitest';
import { netSalesDollars, localDateStr, localHour, localDayOfWeek } from '@/lib/clover';
import type { CloverPayment } from '@/lib/clover';

const payment = (amount: number, refunds: number[] = [], createdTime = 1744000000000): CloverPayment => ({
  id: 'test',
  createdTime,
  amount,
  result: 'SUCCESS',
  refunds: refunds.length > 0 ? { elements: refunds.map(a => ({ amount: a })) } : undefined,
});

describe('netSalesDollars', () => {
  it('converts cents to dollars', () => {
    expect(netSalesDollars(payment(1000))).toBe(10);
  });

  it('subtracts refunds', () => {
    expect(netSalesDollars(payment(1000, [300]))).toBe(7);
  });

  it('subtracts multiple refunds', () => {
    expect(netSalesDollars(payment(5000, [1000, 500]))).toBe(35);
  });

  it('handles full refund', () => {
    expect(netSalesDollars(payment(1000, [1000]))).toBe(0);
  });

  it('handles no refunds', () => {
    const p = payment(2500);
    p.refunds = { elements: [] };
    expect(netSalesDollars(p)).toBe(25);
  });
});

describe('localDateStr', () => {
  it('returns YYYY-MM-DD format', () => {
    // 2026-04-06 midnight UTC = Apr 5 or Apr 6 depending on TZ
    const result = localDateStr(1744000000000, 'America/New_York');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is consistent with the same epoch ms', () => {
    const ms = 1744000000000;
    expect(localDateStr(ms)).toBe(localDateStr(ms));
  });
});

describe('localHour', () => {
  it('returns a value between 0 and 23', () => {
    const hour = localHour(1744000000000, 'America/New_York');
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });
});

describe('localDayOfWeek', () => {
  it('returns a value between 0 and 6', () => {
    const dow = localDayOfWeek(1744000000000, 'America/New_York');
    expect(dow).toBeGreaterThanOrEqual(0);
    expect(dow).toBeLessThanOrEqual(6);
  });
});
