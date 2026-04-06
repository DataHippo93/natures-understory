'use client';

import { formatDateFull, formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { LaborProjection } from '@/lib/types';

interface LaborProjectionsTableProps {
  data: LaborProjection[];
}

export function LaborProjectionsTable({ data }: LaborProjectionsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-stone-200 dark:divide-stone-700">
        <thead>
          <tr className="text-left text-sm font-medium text-stone-500 dark:text-stone-400">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3 text-right">Scheduled Hours</th>
            <th className="px-4 py-3 text-right">Proj. Wages</th>
            <th className="px-4 py-3 text-right">Proj. Loaded</th>
            <th className="px-4 py-3 text-right">Proj. Sales</th>
            <th className="px-4 py-3 text-right">Proj. Labor %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {data.map((row) => (
            <tr key={row.date} className="text-sm">
              <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-900 dark:text-stone-100">
                {formatDateFull(row.date)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {row.scheduledHours.toFixed(1)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {formatCurrency(row.projectedWages)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {formatCurrency(row.projectedLoadedCost)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {formatCurrency(row.projectedSales)}
              </td>
              <td
                className={cn(
                  'px-4 py-3 text-right font-semibold',
                  row.projectedLaborRatio <= 25
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : row.projectedLaborRatio <= 28
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                )}
              >
                {row.projectedLaborRatio}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
