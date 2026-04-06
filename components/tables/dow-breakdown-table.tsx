'use client';

import { formatHour } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { DayOfWeekBreakdown } from '@/lib/types';

interface DOWBreakdownTableProps {
  data: DayOfWeekBreakdown[];
}

export function DOWBreakdownTable({ data }: DOWBreakdownTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-stone-200 dark:divide-stone-700">
        <thead>
          <tr className="text-left text-sm font-medium text-stone-500 dark:text-stone-400">
            <th className="px-4 py-3">Day</th>
            <th className="px-4 py-3 text-center">Avg. Score</th>
            <th className="px-4 py-3">Best Hours (Schedule Chores)</th>
            <th className="px-4 py-3">Peak Hours (All Hands)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {data.map((row) => (
            <tr key={row.day} className="text-sm">
              <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-900 dark:text-stone-100">
                {row.day}
              </td>
              <td className="px-4 py-3 text-center">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                    row.avgQuietScore >= 6
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : row.avgQuietScore >= 4.5
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  )}
                >
                  {row.avgQuietScore.toFixed(1)}
                </span>
              </td>
              <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400">
                {row.bestHours.map(formatHour).join(', ')}
              </td>
              <td className="px-4 py-3 text-red-600 dark:text-red-400">
                {row.peakHours.map(formatHour).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
