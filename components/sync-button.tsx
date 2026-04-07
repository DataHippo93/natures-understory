'use client';

import { useState } from 'react';

interface SyncStatus {
  message: string;
  type: 'idle' | 'loading' | 'success' | 'error';
}

export function SyncButton() {
  const [status, setStatus] = useState<SyncStatus>({ message: '', type: 'idle' });

  const sync = async () => {
    setStatus({ message: 'Syncing categories...', type: 'loading' });
    try {
      // Step 1: Sync categories
      const catRes = await fetch('/api/sync/categories', { method: 'POST' });
      const catData = await catRes.json() as { synced?: number; error?: string };
      if (!catRes.ok) throw new Error(catData.error ?? 'Category sync failed');

      // Step 2: Sync items
      setStatus({ message: 'Syncing items...', type: 'loading' });
      const itemRes = await fetch('/api/sync/items', { method: 'POST' });
      const itemData = await itemRes.json() as { synced?: number; error?: string };
      if (!itemRes.ok) throw new Error(itemData.error ?? 'Item sync failed');

      // Step 3: Sync last 90 days of sales
      setStatus({ message: 'Syncing sales data...', type: 'loading' });
      const end = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      const start = startDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

      const salesRes = await fetch(`/api/sync/sales?start=${start}&end=${end}`, { method: 'POST' });
      const salesData = await salesRes.json() as { synced?: number; error?: string };
      if (!salesRes.ok) throw new Error(salesData.error ?? 'Sales sync failed');

      setStatus({
        message: `Done! ${catData.synced} categories, ${itemData.synced} items, ${salesData.synced} line items`,
        type: 'success',
      });

      // Reset after 5 seconds
      setTimeout(() => setStatus({ message: '', type: 'idle' }), 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ message, type: 'error' });
      setTimeout(() => setStatus({ message: '', type: 'idle' }), 8000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={sync}
        disabled={status.type === 'loading'}
        className="rounded px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-50"
        style={{
          background: status.type === 'loading' ? 'var(--forest-mid)' : 'var(--forest-hover)',
          color: 'var(--gold)',
          border: '1px solid var(--gold)',
          fontFamily: 'var(--font-josefin)',
          cursor: status.type === 'loading' ? 'not-allowed' : 'pointer',
        }}
      >
        {status.type === 'loading' ? 'Syncing...' : 'Sync Clover'}
      </button>
      {status.message && (
        <span
          className="text-xs max-w-xs truncate"
          style={{
            color: status.type === 'error' ? '#b06060' : status.type === 'success' ? '#7aaa62' : 'var(--sage)',
          }}
        >
          {status.message}
        </span>
      )}
    </div>
  );
}
