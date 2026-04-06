import Link from 'next/link';
import { Nav } from './nav';

interface HeaderProps {
  isDemoMode?: boolean;
}

export function Header({ isDemoMode = false }: HeaderProps) {
  return (
    <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-6 w-6"
              >
                <path d="M11 3.055A9.001 9.001 0 1 0 20.945 13H11V3.055Z" />
                <path d="M20.488 11H13V3.512A9.025 9.025 0 0 1 20.488 11Z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-stone-900 dark:text-white">
                Nature&apos;s Understory
              </h1>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Nature&apos;s Storehouse Operations
              </p>
            </div>
          </Link>
          <Nav />
        </div>
        <div className="flex items-center gap-4">
          {isDemoMode && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              Demo Mode
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
