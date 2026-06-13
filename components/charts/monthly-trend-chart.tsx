'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface MonthlyTrendRow {
  month: string;
  label: string;
  revenue: number;
  marginPct: number;
  lossDollars: number;
  marginPctWithLoss: number;
}

/** Revenue (bars, left axis) + margin % month-over-month (line, right axis).
 *  When loss data exists, a second line shows margin after subtracting
 *  shrink/loss — the gap between the two lines is the margin cost of loss. */
export function MonthlyTrendChart({ data, showLoss }: { data: MonthlyTrendRow[]; showLoss: boolean }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No monthly data yet
      </div>
    );
  }
  const anyLoss = showLoss && data.some((d) => d.lossDollars > 0);

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--forest-mid)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--sage)' }} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="rev"
            tick={{ fontSize: 10, fill: 'var(--sage)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <YAxis
            yAxisId="margin"
            orientation="right"
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: 'var(--sage)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as MonthlyTrendRow;
              return (
                <div className="rounded-lg p-3 text-xs shadow-xl" style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}>
                  <p className="font-bold mb-1" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>{d.label}</p>
                  <p style={{ color: 'var(--sage)' }}>Revenue: <span style={{ color: '#c4923a', fontWeight: 700 }}>${d.revenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></p>
                  <p style={{ color: 'var(--sage)' }}>Margin: <span style={{ color: '#7aaa62', fontWeight: 700 }}>{d.marginPct.toFixed(1)}%</span></p>
                  {anyLoss && (
                    <>
                      <p style={{ color: 'var(--sage)' }}>Loss booked: <span style={{ color: '#b06060', fontWeight: 700 }}>${d.lossDollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></p>
                      <p style={{ color: 'var(--sage)' }}>Margin w/ loss: <span style={{ color: '#d96b6b', fontWeight: 700 }}>{d.marginPctWithLoss.toFixed(1)}%</span></p>
                    </>
                  )}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="rev" dataKey="revenue" name="Revenue" fill="#c4923a" radius={[3, 3, 0, 0]} maxBarSize={42} />
          <Line yAxisId="margin" type="monotone" dataKey="marginPct" name="Margin %" stroke="#7aaa62" strokeWidth={2.5} dot={{ r: 3 }} />
          {anyLoss && (
            <Line yAxisId="margin" type="monotone" dataKey="marginPctWithLoss" name="Margin w/ loss %" stroke="#d96b6b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
