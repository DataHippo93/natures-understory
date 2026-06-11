'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div
        className="max-w-md rounded-lg p-6 text-center"
        style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}
      >
        <p className="text-3xl mb-3">🍂</p>
        <h2
          className="text-lg font-bold uppercase tracking-wider mb-2"
          style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}
        >
          Data Unavailable
        </h2>
        <p className="text-sm mb-1" style={{ color: 'var(--cream)' }}>
          This page couldn&apos;t load its data — rather than show you numbers that
          might be wrong, it stopped here.
        </p>
        <p className="text-xs mb-4 font-mono break-words" style={{ color: 'var(--text-muted)' }}>
          {error.message}
        </p>
        <button
          onClick={reset}
          className="rounded px-4 py-2 text-xs font-bold uppercase tracking-widest"
          style={{ background: 'var(--gold)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
