'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** "full" (default) is full-screen on mobile / centered on desktop. Set
   * "center" to always render centered with backdrop. */
  mode?: 'full' | 'center';
  className?: string;
}

/**
 * Responsive modal. On mobile it takes over the viewport with safe-area
 * insets; on desktop it centers as a card. Backdrop click and Escape both
 * close.
 */
export function Modal({ open, onClose, title, children, mode = 'full', className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'relative flex w-full flex-col',
          mode === 'full'
            ? 'h-full sm:h-auto sm:max-h-[85vh] sm:max-w-lg sm:rounded-xl'
            : 'max-h-[85vh] w-full max-w-lg m-4 rounded-xl',
          className,
        )}
        style={{
          background: 'var(--forest)',
          border: '1px solid var(--forest-mid)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {title && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
            style={{ borderBottom: '1px solid var(--forest-mid)' }}
          >
            <h2
              className="text-sm font-bold uppercase tracking-widest min-w-0 break-words"
              style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}
            >{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="u-tap-target flex items-center justify-center rounded-md"
              style={{ color: 'var(--cream)', border: '1px solid var(--forest-mid)' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {children}
        </div>
      </div>
    </div>
  );
}
