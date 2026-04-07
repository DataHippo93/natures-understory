'use client';

import { cn } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: number;
  status?: 'good' | 'warning' | 'bad' | 'neutral';
  icon?: React.ReactNode;
}

const valueColors = {
  good:    'var(--good)',
  warning: 'var(--warn)',
  bad:     'var(--bad)',
  neutral: 'var(--cream)',
};

export function KPICard({ title, value, subtitle, change, status = 'neutral', icon }: KPICardProps) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-widest truncate"
            style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}
          >
            {title}
          </p>
          <p
            className="text-3xl font-bold leading-none"
            style={{ color: valueColors[status], fontFamily: 'var(--font-josefin)' }}
          >
            {value}
          </p>
          {subtitle && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
          )}
          {change !== undefined && (
            <p
              className="text-xs font-semibold"
              style={{ color: change >= 0 ? 'var(--good)' : 'var(--bad)' }}
            >
              {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs yesterday
            </p>
          )}
        </div>
        {icon && (
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ml-3"
            style={{ background: 'var(--forest-mid)' }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
