import { cn } from '@/lib/utils';

interface PageProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';
}

const maxW: Record<NonNullable<PageProps['maxWidth']>, string> = {
  sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl',
  '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl', '6xl': 'max-w-6xl', '7xl': 'max-w-7xl',
  full: 'max-w-none',
};

/**
 * Page container. Consistent vertical rhythm and a responsive max width.
 * Use once per route as the outermost element inside a page component.
 */
export function Page({ children, className, maxWidth = '6xl' }: PageProps) {
  return <div className={cn('space-y-5 sm:space-y-6', maxW[maxWidth], className)}>{children}</div>;
}

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Page title block. Stacks vertically on mobile, splits title/actions on ≥sm.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1
          className="text-xl sm:text-2xl font-bold uppercase tracking-wider break-words"
          style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm" style={{ color: 'var(--sage)' }}>{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
