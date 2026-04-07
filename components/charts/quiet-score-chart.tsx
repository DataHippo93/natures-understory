'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatHour, formatCurrency } from '@/lib/utils';
import type { QuietScore } from '@/lib/types';

interface QuietScoreChartProps {
  data: QuietScore[];
}

const getBarColor = (score: number) => {
  if (score >= 7) return '#7aaa62'; // good — healthy plant green
  if (score >= 4) return '#c4923a'; // warn — amber
  return '#b06060';                 // bad — brick
};

export function QuietScoreChart({ data }: QuietScoreChartProps) {
  const chartData = data.map((item) => ({ ...item, hourLabel: formatHour(item.hour) }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--forest-mid)" vertical={false} />
          <XAxis dataKey="hourLabel" tick={{ fontSize: 11, fill: 'var(--sage)' }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: 'var(--sage)' }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as QuietScore & { hourLabel: string };
              return (
                <div className="rounded-lg p-3 text-sm shadow-xl" style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}>
                  <p className="font-bold mb-1" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>{d.hourLabel}</p>
                  <p style={{ color: 'var(--sage)' }}>Score: <span style={{ color: getBarColor(d.score), fontWeight: 700 }}>{d.score.toFixed(1)}</span></p>
                  <p style={{ color: 'var(--sage)' }}>Transactions: <span style={{ color: 'var(--cream)', fontWeight: 700 }}>{d.transactions}</span></p>
                  {d.hourlySales > 0 && <p style={{ color: 'var(--sage)' }}>Sales: <span style={{ color: 'var(--cream)', fontWeight: 700 }}>{formatCurrency(d.hourlySales)}</span></p>}
                  <p className="capitalize text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{d.label} period</p>
                </div>
              );
            }}
          />
          <Bar dataKey="score" radius={[3, 3, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={`cell-${i}`} fill={getBarColor(entry.score)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
