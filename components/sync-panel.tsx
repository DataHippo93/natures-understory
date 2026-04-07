'use client';

import { useState } from 'react';

type SyncPhase = 'idle' | 'categories' | 'items' | 'sales' | 'done' | 'error';

interface SyncState {
  phase: SyncPhase;
  message: string;
  details: string;
}

export function SyncPanel() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const defaultStart = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(today);
  const [state, setState] = useState<SyncState>({ phase: 'idle', message: '', details: '' });

  const sync = async () => {
    setState({ phase: 'categories', message: 'Syncing categories...', details: '' });
    try {
      const catRes = await fetch('/api/sync/categories', { method: 'POST' });
      const catData = await catRes.json() as { synced?: number; error?: string };
      if (!catRes.ok) throw new Error(catData.error ?? 'Category sync failed');

      setState({ phase: 'items', message: 'Syncing items...', details: `${catData.synced} categories synced` });
      const itemRes = await fetch('/api/sync/items', { method: 'POST' });
      const itemData = await itemRes.json() as { synced?: number; error?: string };
      if (!itemRes.ok) throw new Error(itemData.error ?? 'Item sync failed');

      setState({
        phase: 'sales',
        message: `Syncing sales (${startDate} → ${endDate})...`,
        details: `${catData.synced} categories, ${itemData.synced} items synced`,
      });

      const salesRes = await fetch(`/api/sync/sales?start=${startDate}&end=${endDate}`, { method: 'POST' });
      const salesData = await salesRes.json() as { synced?: number; orders?: number; error?: string };
      if (!salesRes.ok) throw new Error(salesData.error ?? 'Sales sync failed');

      setState({
        phase: 'done',
        message: 'Sync complete!',
        details: `${catData.synced} categories · ${itemData.synced} items · ${salesData.synced} line items from ${salesData.orders} orders`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ phase: 'error', message: 'Sync failed', details: message });
    }
  };

  const phaseColors: Record<SyncPhase, string> = {
    idle: 'var(--text-muted)',
    categories: '#c4923a',
    items: '#c4923a',
    sales: '#c4923a',
    done: '#7aaa62',
    error: '#b06060',
  };

  const isRunning = ['categories', 'items', 'sales'].includes(state.phase);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
            Sync Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={isRunning}
            className="rounded px-3 py-1.5 text-xs outline-none"
            style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
            Sync End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={isRunning}
            className="rounded px-3 py-1.5 text-xs outline-none"
            style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
          />
        </div>
        <button
          onClick={sync}
          disabled={isRunning}
          className="rounded px-4 py-1.5 text-xs font-bold transition-all disabled:opacity-50"
          style={{
            background: isRunning ? 'var(--forest-mid)' : 'var(--gold)',
            color: isRunning ? 'var(--sage)' : 'var(--forest-darkest)',
            fontFamily: 'var(--font-josefin)',
            cursor: isRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {state.phase !== 'idle' && (
        <div className="rounded-lg px-4 py-3" style={{ background: 'var(--forest-darkest)', border: `1px solid ${phaseColors[state.phase]}22` }}>
          <div className="flex items-center gap-2">
            {isRunning && (
              <div
                className="h-2 w-2 rounded-full animate-pulse"
                style={{ background: phaseColors[state.phase] }}
              />
            )}
            <p className="text-sm font-semibold" style={{ color: phaseColors[state.phase], fontFamily: 'var(--font-josefin)' }}>
              {state.message}
            </p>
          </div>
          {state.details && (
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{state.details}</p>
          )}
          {/* Progress steps */}
          {isRunning && (
            <div className="mt-3 flex items-center gap-2">
              {[
                { key: 'categories', label: 'Categories' },
                { key: 'items', label: 'Items' },
                { key: 'sales', label: 'Sales' },
              ].map((step, i) => {
                const phases = ['categories', 'items', 'sales'];
                const currentIdx = phases.indexOf(state.phase);
                const stepIdx = i;
                const done = stepIdx < currentIdx;
                const active = stepIdx === currentIdx;
                return (
                  <div key={step.key} className="flex items-center gap-2">
                    {i > 0 && <div className="h-px w-4" style={{ background: done ? '#7aaa62' : 'var(--forest-mid)' }} />}
                    <div className="flex items-center gap-1">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: done ? '#7aaa62' : active ? '#c4923a' : 'var(--forest-mid)',
                        }}
                      />
                      <span className="text-[10px]" style={{ color: done ? '#7aaa62' : active ? '#c4923a' : 'var(--forest-light)', fontFamily: 'var(--font-josefin)' }}>
                        {step.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Syncing pulls categories, items, and order line items from Clover POS. Large date ranges may take 1-2 minutes.
      </p>
    </div>
  );
}
