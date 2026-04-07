'use client';

import { formatDateFull, formatCurrency } from '@/lib/utils';
import type { LaborProjection } from '@/lib/types';

interface LaborProjectionsTableProps {
  data: LaborProjection[];
}

const ratioColor = (r: number) =>
  r <= 25 ? '#68d391' : r <= 28 ? '#f2ad22' : '#fc8181';

export function LaborProjectionsTable({ data }: LaborProjectionsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
            {['Date', 'Sched. Hours', 'Proj. Wages', 'Proj. Loaded', 'Proj. Sales', 'Proj. Labor %'].map((h, i) => (
              <th key={h} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest ${i > 0 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row.date}
              style={{ borderBottom: i < data.length - 1 ? '1px solid var(--forest-mid)' : 'none', opacity: 0.85 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--forest-hover)'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
            >
              <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--cream)' }}>
                {formatDateFull(row.date)}
                <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(104,211,145,0.12)', color: '#68d391', border: '1px solid rgba(104,211,145,0.25)' }}>projected</span>
              </td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{row.scheduledHours.toFixed(1)}</td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{formatCurrency(row.projectedWages)}</td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{formatCurrency(row.projectedLoadedCost)}</td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{formatCurrency(row.projectedSales)}</td>
              <td className="px-4 py-2.5 text-right font-bold" style={{ color: ratioColor(row.projectedLaborRatio) }}>{row.projectedLaborRatio}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
