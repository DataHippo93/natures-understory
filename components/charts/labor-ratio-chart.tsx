'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { formatDate } from '@/lib/utils';
import type { LaborActuals, LaborProjection } from '@/lib/types';

interface LaborRatioChartProps {
  actuals: LaborActuals[];
  projections: LaborProjection[];
  targetRatio?: number;
}

export function LaborRatioChart({ actuals, projections, targetRatio = 25 }: LaborRatioChartProps) {
  const chartData = [
    ...actuals.map((a) => ({
      date: a.date,
      dateLabel: formatDate(a.date),
      actualRatio: a.laborRatio,
      projectedRatio: null as number | null,
    })),
    ...projections.map((p) => ({
      date: p.date,
      dateLabel: formatDate(p.date),
      actualRatio: null as number | null,
      projectedRatio: p.projectedLaborRatio,
    })),
  ];

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 40, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--forest-mid)" vertical={false} />
          <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: 'var(--sage)' }} axisLine={false} tickLine={false} interval={2} />
          <YAxis domain={[10, 40]} tick={{ fontSize: 11, fill: 'var(--sage)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            cursor={{ stroke: 'var(--forest-mid)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="rounded-lg p-3 text-sm shadow-xl" style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}>
                  <p className="font-bold mb-1" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>{d.dateLabel}</p>
                  {d.actualRatio != null && <p style={{ color: 'var(--sage)' }}>Actual: <span style={{ color: '#c4923a', fontWeight: 700 }}>{d.actualRatio}%</span></p>}
                  {d.projectedRatio != null && <p style={{ color: 'var(--sage)' }}>Projected: <span style={{ color: '#7aaa62', fontWeight: 700 }}>{d.projectedRatio}%</span></p>}
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '11px', color: 'var(--sage)' }}
            formatter={(value) => <span style={{ color: 'var(--sage)' }}>{value}</span>}
          />
          <ReferenceLine y={targetRatio} stroke="rgba(196,146,58,0.4)" strokeDasharray="5 5" label={{ value: `Target ${targetRatio}%`, position: 'right', fontSize: 10, fill: 'var(--gold)' }} />
          <Line type="monotone" dataKey="actualRatio" stroke="#c4923a" strokeWidth={2} dot={{ fill: '#c4923a', r: 3 }} name="Actual" connectNulls={false} />
          <Line type="monotone" dataKey="projectedRatio" stroke="#7aaa62" strokeWidth={2} strokeDasharray="5 4" dot={{ fill: '#7aaa62', r: 3 }} name="Projected" connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
