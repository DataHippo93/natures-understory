import { cn } from '@/lib/utils';

interface SectionProps {
  children: React.ReactNode;
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Semantic section wrapper. Consistent vertical spacing between the header
 * row and content; on mobile the header stacks under itself, then splits
 * title/actions at sm.
 */
export function Section({ children, title, description, actions, className }: SectionProps) {
  return (
    <section className={cn('space-y-3 sm:space-y-4', className)}>
      {(title || actions) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && (
              <h2
                className="text-xs sm:text-sm font-bold uppercase tracking-widest"
                style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}
              >{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
