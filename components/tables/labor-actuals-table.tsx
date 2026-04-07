'use client';

import { formatDateFull, formatCurrency } from '@/lib/utils';
import type { LaborActuals } from '@/lib/types';

interface LaborActualsTableProps {
  data: LaborActuals[];
}

const ratioColor = (r: number) =>
  r <= 25 ? '#7aaa62' : r <= 28 ? '#c4923a' : '#b06060';

export function LaborActualsTable({ data }: LaborActualsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
            {['Date', 'Hours', 'Wages', 'Loaded Cost', 'Net Sales', 'Labor %'].map((h, i) => (
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
              style={{ borderBottom: i < data.length - 1 ? '1px solid var(--forest-mid)' : 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--forest-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--cream)' }}>{formatDateFull(row.date)}</td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{row.timesheetHours.toFixed(1)}</td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{formatCurrency(row.wages)}</td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{formatCurrency(row.fullyLoadedCost)}</td>
              <td className="px-4 py-2.5 text-right" style={{ color: 'var(--sage)' }}>{formatCurrency(row.netSales)}</td>
              <td className="px-4 py-2.5 text-right font-bold" style={{ color: ratioColor(row.laborRatio) }}>{row.laborRatio}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
