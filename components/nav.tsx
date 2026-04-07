'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/shifts', label: 'Shift Analysis' },
  { href: '/labor', label: 'Labor Ratio' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center space-x-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-white text-emerald-700 shadow-sm dark:bg-stone-900 dark:text-emerald-400'
                : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
