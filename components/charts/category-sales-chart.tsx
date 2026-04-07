'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface CategorySalesRow {
  category_name: string | null;
  revenue: number;
  items_sold: number;
}

interface CategorySalesChartProps {
  data: CategorySalesRow[];
}

const COLORS = [
  '#c4923a', '#7aaa62', '#8fa872', '#b06060', '#a07840',
  '#6b8a55', '#d4a45a', '#9bc07a', '#c08050', '#80a468',
];

export function CategorySalesChart({ data }: CategorySalesChartProps) {
  const chartData = data
    .slice(0, 12)
    .map((d) => ({
      name: d.category_name ?? 'Uncategorized',
      revenue: d.revenue,
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No data for this period
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--forest-mid)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: 'var(--sage)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 11, fill: 'var(--cream)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { name: string; revenue: number };
              return (
                <div
                  className="rounded-lg p-3 text-sm shadow-xl"
                  style={{
                    background: 'var(--forest-darkest)',
                    border: '1px solid var(--forest-mid)',
                    color: 'var(--cream)',
                  }}
                >
                  <p className="font-bold mb-1" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
                    {d.name}
                  </p>
                  <p style={{ color: 'var(--sage)' }}>
                    Revenue:{' '}
                    <span style={{ color: '#c4923a', fontWeight: 700 }}>
                      ${d.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
