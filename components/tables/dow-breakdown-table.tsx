'use client';

import { formatHour } from '@/lib/utils';
import type { DayOfWeekBreakdown } from '@/lib/types';

interface DOWBreakdownTableProps {
  data: DayOfWeekBreakdown[];
}

const scorePill = (score: number) => {
  if (score >= 6) return { background: 'rgba(122,170,98,0.15)', color: '#7aaa62', border: '1px solid rgba(122,170,98,0.3)' };
  if (score >= 4.5) return { background: 'rgba(196,146,58,0.15)', color: '#c4923a', border: '1px solid rgba(196,146,58,0.3)' };
  return { background: 'rgba(176,96,96,0.15)', color: '#b06060', border: '1px solid rgba(176,96,96,0.3)' };
};

export function DOWBreakdownTable({ data }: DOWBreakdownTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
            {['Day', 'Avg. Score', 'Best Hours — Schedule Chores', 'Peak Hours — All Hands'].map((h) => (
              <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row.day}
              style={{ borderBottom: i < data.length - 1 ? '1px solid var(--forest-mid)' : 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--forest-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <td className="px-4 py-2.5 font-semibold" style={{ color: 'var(--cream)' }}>{row.day}</td>
              <td className="px-4 py-2.5">
                <span className="rounded px-2 py-0.5 text-xs font-bold" style={scorePill(row.avgQuietScore)}>
                  {row.avgQuietScore.toFixed(1)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-xs" style={{ color: '#7aaa62' }}>
                {row.bestHours.length > 0 ? row.bestHours.map(formatHour).join(', ') : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
              <td className="px-4 py-2.5 text-xs" style={{ color: '#b06060' }}>
                {row.peakHours.length > 0 ? row.peakHours.map(formatHour).join(', ') : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
