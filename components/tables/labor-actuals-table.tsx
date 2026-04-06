'use client';

import { formatDateFull, formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { LaborActuals } from '@/lib/types';

interface LaborActualsTableProps {
  data: LaborActuals[];
}

export function LaborActualsTable({ data }: LaborActualsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-stone-200 dark:divide-stone-700">
        <thead>
          <tr className="text-left text-sm font-medium text-stone-500 dark:text-stone-400">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3 text-right">Hours</th>
            <th className="px-4 py-3 text-right">Wages</th>
            <th className="px-4 py-3 text-right">Loaded Cost</th>
            <th className="px-4 py-3 text-right">Net Sales</th>
            <th className="px-4 py-3 text-right">Labor %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {data.map((row) => (
            <tr key={row.date} className="text-sm">
              <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-900 dark:text-stone-100">
                {formatDateFull(row.date)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {row.timesheetHours.toFixed(1)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {formatCurrency(row.wages)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {formatCurrency(row.fullyLoadedCost)}
              </td>
              <td className="px-4 py-3 text-right text-stone-600 dark:text-stone-400">
                {formatCurrency(row.netSales)}
              </td>
              <td
                className={cn(
                  'px-4 py-3 text-right font-semibold',
                  row.laborRatio <= 25
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : row.laborRatio <= 28
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                )}
              >
                {row.laborRatio}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
