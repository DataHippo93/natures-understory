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
import { formatHour } from '@/lib/utils';
import type { QuietScore } from '@/lib/types';

interface QuietScoreChartProps {
  data: QuietScore[];
}

export function QuietScoreChart({ data }: QuietScoreChartProps) {
  const getBarColor = (score: number) => {
    if (score >= 7) return '#10b981'; // emerald-500 (quiet)
    if (score >= 4) return '#f59e0b'; // amber-500 (light)
    return '#ef4444'; // red-500 (peak)
  };

  const chartData = data.map((item) => ({
    ...item,
    hourLabel: formatHour(item.hour),
  }));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-stone-200 dark:stroke-stone-700" />
          <XAxis
            dataKey="hourLabel"
            tick={{ fontSize: 12 }}
            className="text-stone-500"
          />
          <YAxis
            domain={[0, 10]}
            tick={{ fontSize: 12 }}
            className="text-stone-500"
            label={{ value: 'Quiet Score', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload as QuietScore & { hourLabel: string };
                return (
                  <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-800">
                    <p className="font-medium">{data.hourLabel}</p>
                    <p className="text-sm text-stone-500">
                      Score: <span className="font-semibold">{data.score.toFixed(1)}</span>
                    </p>
                    <p className="text-sm capitalize text-stone-500">
                      Status: <span className="font-semibold">{data.label}</span>
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="score" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry.score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
