'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';

interface ScheduleDatePickerProps {
  current: string;   // YYYY-MM-DD
  today: string;     // YYYY-MM-DD
}

export function ScheduleDatePicker({ current, today }: ScheduleDatePickerProps) {
  const router = useRouter();
  const pathname = usePathname();

  const navigate = useCallback((date: string) => {
    if (date === today) {
      router.push(pathname);
    } else {
      router.push(`${pathname}?date=${date}`);
    }
  }, [router, pathname, today]);

  const offset = (n: number) => {
    const d = new Date(current + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('en-CA');
  };

  const isToday = current === today;
  const isTomorrow = offset(-1) === today;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Quick nav */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => navigate(offset(-1))}
          className="rounded px-2 py-1.5 text-xs transition-colors"
          style={{ background: 'var(--forest-mid)', color: 'var(--sage)', border: '1px solid var(--forest-mid)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--cream)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--sage)'; }}
        >
          ‹
        </button>
        <button
          onClick={() => navigate(today)}
          className="rounded px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-all"
          style={{
            fontFamily: 'var(--font-josefin)',
            background: isToday ? 'var(--gold)' : 'var(--forest-mid)',
            color: isToday ? 'var(--forest-darkest)' : 'var(--sage)',
            border: `1px solid ${isToday ? 'var(--gold)' : 'var(--forest-mid)'}`,
          }}
        >
          Today
        </button>
        <button
          onClick={() => navigate(offset(1))}
          className="rounded px-2 py-1.5 text-xs transition-colors"
          style={{ background: 'var(--forest-mid)', color: 'var(--sage)', border: '1px solid var(--forest-mid)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--cream)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--sage)'; }}
        >
          ›
        </button>
      </div>

      {/* Date input */}
      <input
        type="date"
        value={current}
        onChange={(e) => e.target.value && navigate(e.target.value)}
        className="rounded-md px-3 py-1.5 text-xs outline-none"
        style={{
          background: 'var(--forest-mid)',
          border: '1px solid var(--forest-mid)',
          color: 'var(--cream)',
          colorScheme: 'dark',
        }}
        onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
        onBlur={(e) => (e.target.style.borderColor = 'var(--forest-mid)')}
      />
    </div>
  );
}
