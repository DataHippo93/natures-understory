'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: number;
  status?: 'good' | 'warning' | 'bad' | 'neutral';
  icon?: React.ReactNode;
}

export function KPICard({ title, value, subtitle, change, status = 'neutral', icon }: KPICardProps) {
  const statusColors = {
    good: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
    neutral: 'text-stone-600 dark:text-stone-400',
  };

  const bgColors = {
    good: 'bg-emerald-50 dark:bg-emerald-950/30',
    warning: 'bg-amber-50 dark:bg-amber-950/30',
    bad: 'bg-red-50 dark:bg-red-950/30',
    neutral: 'bg-stone-50 dark:bg-stone-900/30',
  };

  return (
    <Card className={cn('relative overflow-hidden', bgColors[status])}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{title}</p>
            <p className={cn('text-3xl font-bold', statusColors[status])}>{value}</p>
            {subtitle && (
              <p className="text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>
            )}
            {change !== undefined && (
              <p
                className={cn(
                  'text-sm font-medium',
                  change >= 0 ? 'text-emerald-600' : 'text-red-600'
                )}
              >
                {change >= 0 ? '+' : ''}
                {change.toFixed(1)}% vs last week
              </p>
            )}
          </div>
          {icon && (
            <div className={cn('rounded-lg p-2', bgColors[status])}>
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
