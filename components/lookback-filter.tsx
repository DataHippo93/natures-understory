'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '60D', days: 60 },
  { label: '90D', days: 90 },
  { label: '180D', days: 180 },
  { label: '365D', days: 365 },
];

interface LookbackFilterProps {
  current: number;
  paramName?: string;
  /** Active calendar month (YYYY-MM) — set via ?month=, overrides day presets. */
  currentMonth?: string | null;
  monthLabel?: string | null;
}

export function LookbackFilter({
  current,
  paramName = 'days',
  currentMonth = null,
  monthLabel = null,
}: LookbackFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customValue, setCustomValue] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [monthValue, setMonthValue] = useState(currentMonth ?? '');

  const isPreset = PRESETS.some((p) => p.days === current) && !currentMonth;

  const navigate = (days: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, String(days));
    params.delete('month');
    router.push(`${pathname}?${params.toString()}`);
  };

  const navigateMonth = (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', month);
    params.delete(paramName);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(customValue);
    if (n > 0 && n <= 730) {
      navigate(n);
      setShowCustom(false);
      setCustomValue('');
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-widest mr-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
        Lookback
      </span>

      <div className="flex items-center gap-1">
        {PRESETS.map((p) => {
          const active = current === p.days && !showCustom && !currentMonth;
          return (
            <button
              key={p.days}
              onClick={() => { navigate(p.days); setShowCustom(false); }}
              className="rounded px-2.5 py-1 text-xs font-semibold transition-all"
              style={{
                background: active ? 'var(--gold)' : 'var(--forest)',
                color: active ? 'var(--forest-darkest)' : 'var(--sage)',
                border: `1px solid ${active ? 'var(--gold)' : 'var(--forest-mid)'}`,
                fontFamily: 'var(--font-josefin)',
              }}
            >
              {p.label}
            </button>
          );
        })}

        {/* Custom */}
        {!showCustom ? (
          <button
            onClick={() => setShowCustom(true)}
            className="rounded px-2.5 py-1 text-xs font-semibold transition-all"
            style={{
              background: !isPreset ? 'var(--gold)' : 'var(--forest)',
              color: !isPreset ? 'var(--forest-darkest)' : 'var(--sage)',
              border: `1px solid ${!isPreset ? 'var(--gold)' : 'var(--forest-mid)'}`,
              fontFamily: 'var(--font-josefin)',
            }}
          >
            {!isPreset ? `${current}D` : 'Custom'}
          </button>
        ) : (
          <form onSubmit={handleCustomSubmit} className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={730}
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="Days"
              autoFocus
              className="w-16 rounded px-2 py-1 text-xs outline-none"
              style={{ background: 'var(--forest-darkest)', border: '1px solid var(--gold)', color: 'var(--cream)' }}
            />
            <button type="submit" className="rounded px-2 py-1 text-xs font-bold" style={{ background: 'var(--gold)', color: 'var(--forest-darkest)' }}>
              Go
            </button>
            <button type="button" onClick={() => setShowCustom(false)} className="rounded px-2 py-1 text-xs" style={{ color: 'var(--sage)', border: '1px solid var(--forest-mid)' }}>
              ✕
            </button>
          </form>
        )}
      </div>

      {/* Calendar month */}
      <div className="flex items-center gap-1 ml-1">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
          or month
        </span>
        <input
          type="month"
          value={monthValue}
          max={new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 7)}
          onChange={(e) => {
            setMonthValue(e.target.value);
            if (e.target.value) navigateMonth(e.target.value);
          }}
          className="rounded px-2 py-1 text-xs outline-none"
          style={{
            background: currentMonth ? 'var(--gold)' : 'var(--forest-darkest)',
            color: currentMonth ? 'var(--forest-darkest)' : 'var(--cream)',
            border: `1px solid ${currentMonth ? 'var(--gold)' : 'var(--forest-mid)'}`,
            colorScheme: 'dark',
          }}
        />
      </div>

      <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>
        ({monthLabel ?? `${current} days`})
      </span>
    </div>
  );
}
