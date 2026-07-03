import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Form field wrapper: consistent label, tap-target sizing, hint, and error
 * slot. Inputs rendered inside should use the .u-input utility class from
 * globals.css so font-size stays >=16px (iOS Safari zooms otherwise) and
 * padding meets 44px tap-target minimums.
 */
export function FormField({ label, htmlFor, hint, error, children, className }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}
      >{label}</label>
      {children}
      {hint && !error && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--bad)' }}>{error}</p>
      )}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * Mobile-safe <input>. Uses u-input for min-16px font-size (blocks iOS zoom
 * on focus) and 44px min-height tap target.
 */
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn('u-input w-full', className)}
      style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}
      {...props}
    />
  );
}
