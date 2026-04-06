'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { formatDate } from '@/lib/utils';
import type { LaborActuals, LaborProjection } from '@/lib/types';

interface LaborRatioChartProps {
  actuals: LaborActuals[];
  projections: LaborProjection[];
  targetRatio?: number;
}

export function LaborRatioChart({ actuals, projections, targetRatio = 25 }: LaborRatioChartProps) {
  // Combine data for the chart
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
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-stone-200 dark:stroke-stone-700" />
          <XAxis
            dataKey="dateLabel"
            tick={{ fontSize: 11 }}
            className="text-stone-500"
            interval={2}
          />
          <YAxis
            domain={[15, 35]}
            tick={{ fontSize: 12 }}
            className="text-stone-500"
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-800">
                    <p className="font-medium">{data.dateLabel}</p>
                    {data.actualRatio && (
                      <p className="text-sm text-emerald-600">
                        Actual: <span className="font-semibold">{data.actualRatio}%</span>
                      </p>
                    )}
                    {data.projectedRatio && (
                      <p className="text-sm text-blue-600">
                        Projected: <span className="font-semibold">{data.projectedRatio}%</span>
                      </p>
                    )}
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend />
          <ReferenceLine
            y={targetRatio}
            stroke="#f59e0b"
            strokeDasharray="5 5"
            label={{ value: `Target ${targetRatio}%`, position: 'right', fontSize: 11 }}
          />
          <Line
            type="monotone"
            dataKey="actualRatio"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ fill: '#10b981', strokeWidth: 2 }}
            name="Actual"
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="projectedRatio"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: '#3b82f6', strokeWidth: 2 }}
            name="Projected"
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
