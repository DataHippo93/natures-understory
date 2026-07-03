import { cn } from '@/lib/utils';

interface StatGridProps {
  children: React.ReactNode;
  cols?: { base?: 1 | 2; sm?: 1 | 2 | 3; md?: 2 | 3 | 4; lg?: 2 | 3 | 4 };
  className?: string;
}

/**
 * Responsive grid of "big number" stat cards. Mobile-first: 1 col on
 * phones, 2 on small tablets, 3–4 on desktop. Defaults chosen so most
 * dashboard grids need zero props.
 */
export function StatGrid({ children, cols, className }: StatGridProps) {
  const base = cols?.base ?? 1;
  const sm = cols?.sm ?? 2;
  const md = cols?.md;
  const lg = cols?.lg ?? 3;
  const classes = cn(
    'grid gap-3 sm:gap-4',
    base === 1 ? 'grid-cols-1' : 'grid-cols-2',
    sm === 1 ? 'sm:grid-cols-1' : sm === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3',
    md === 2 ? 'md:grid-cols-2' : md === 3 ? 'md:grid-cols-3' : md === 4 ? 'md:grid-cols-4' : '',
    lg === 2 ? 'lg:grid-cols-2' : lg === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
    className,
  );
  return <div className={classes}>{children}</div>;
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  status?: 'good' | 'warning' | 'bad' | 'neutral';
}

const statColor = {
  good: 'var(--good)',
  warning: 'var(--warn)',
  bad: 'var(--bad)',
  neutral: 'var(--cream)',
};

/**
 * Big-number stat card. Use inside <StatGrid>. Consistent padding and
 * mobile-safe font sizes.
 */
export function Stat({ label, value, hint, status = 'neutral' }: StatProps) {
  return (
    <div
      className="rounded-lg p-4 sm:p-5"
      style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}
      >{label}</p>
      <p
        className="mt-1 text-2xl sm:text-3xl font-bold leading-none"
        style={{ color: statColor[status], fontFamily: 'var(--font-josefin)' }}
      >{value}</p>
      {hint && (
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>
      )}
    </div>
  );
}
