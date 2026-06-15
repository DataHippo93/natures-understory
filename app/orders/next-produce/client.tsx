'use client';

import type React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { NextOrderEvaluation, NextOrderRow } from '@/lib/next-order';
import type { CostSource } from '@/lib/inventory-cost';
import type { ParsedAction } from '@/lib/notes-parser';
import type { LlmParsedLine } from '@/lib/notes-parser-llm';

const FILTERS = [
  { value: 'order', label: 'To Order' },
  { value: 'all',   label: 'All' },
  { value: 'buy',   label: 'Buy' },
  { value: 'skip',  label: 'Skip' },
  { value: 'review',label: 'Review' },
] as const;
type FilterValue = (typeof FILTERS)[number]['value'];

function urgencyColor(dos: number | null): string {
  if (dos == null) return '#6b7280';
  if (dos < 1) return '#b06060';
  if (dos < 3) return '#c4923a';
  if (dos < 7) return '#7aaa62';
  return '#6b7280';
}
function costShort(s: CostSource): string {
  return s === 'last_receipt' ? 'fresh' : s === 'default' ? 'stale' : 'n/a';
}
function costTitle(s: CostSource): string {
  return s === 'last_receipt'
    ? 'Cost from most recent inventory lot in Thrive'
    : s === 'default'
      ? 'Catalog default cost — may be out of date'
      : 'No cost on file in Thrive';
}
function costChipStyle(s: CostSource): React.CSSProperties {
  if (s === 'last_receipt') return { background: 'rgba(122,170,98,0.18)', color: '#7aaa62', fontFamily: 'var(--font-josefin)' };
  if (s === 'default')      return { background: 'rgba(196,146,58,0.20)', color: '#c4923a', fontFamily: 'var(--font-josefin)' };
  return { background: 'rgba(176,96,96,0.20)', color: '#d96b6b', fontFamily: 'var(--font-josefin)' };
}

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}
function fmtDollars(v: number | null): string {
  if (v == null) return '—';
  return `$${v.toFixed(2)}`;
}
function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function verdictColor(v: NextOrderRow['verdict']) {
  switch (v) {
    case 'BUY':    return { bg: 'rgba(122,170,98,0.15)',  fg: '#7aaa62' };
    case 'SKIP':   return { bg: 'rgba(176,96,96,0.15)',   fg: '#b06060' };
    case 'REVIEW': return { bg: 'rgba(196,146,58,0.12)',  fg: '#c4923a' };
  }
}

function confChipStyle(conf?: string): React.CSSProperties {
  const c = (conf ?? '').toLowerCase();
  if (c === 'high') return { background: 'rgba(122,170,98,0.22)', color: '#7aaa62' };
  if (c === 'med')  return { background: 'rgba(196,146,58,0.22)', color: '#c4923a' };
  if (c === 'low')  return { background: 'rgba(176,96,96,0.22)',  color: '#d96b6b' };
  return { background: 'rgba(107,107,107,0.22)', color: '#6b7280' };
}

function AiActionItem({ line }: { line: LlmParsedLine }) {
  const a = line.action;
  const conf = a.kind !== 'ambiguous' && a.kind !== 'unparseable' ? a.confidence : undefined;
  const isErr = a.kind === 'unparseable';
  return (
    <li className="flex flex-col gap-0.5" style={{ borderLeft: `2px solid ${isErr ? '#b06060' : 'var(--forest-mid)'}`, paddingLeft: 6 }}>
      <div className="flex items-center gap-1.5">
        <span style={{ color: 'var(--gold)', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.1em' }}>{a.kind}</span>
        {conf ? (
          <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={confChipStyle(conf)}>{conf}</span>
        ) : null}
        <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{line.source === 'cache' ? '⊙ cache' : 'llm'}</span>
      </div>
      <div style={{ color: 'var(--cream)' }}>
        {a.kind === 'add' && `${a.qty} ${a.unit} → ${line.bound_item_name ?? a.sku_hint}`}
        {a.kind === 'skip' && `${line.bound_item_name ?? a.sku_hint} — ${a.reason}`}
        {a.kind === 'so' && `${a.customer} · ${a.qty} ${a.unit} ${line.bound_item_name ?? a.sku_hint}`}
        {a.kind === 'note' && `${line.bound_item_name ?? a.sku_hint ?? 'general'}: ${a.text}`}
        {a.kind === 'flag' && `🚩 ${line.bound_item_name ?? a.sku_hint ?? 'general'} — ${a.reason}`}
        {a.kind === 'ambiguous' && `❓ ambiguous: ${a.candidates.join(' / ')}`}
        {a.kind === 'unparseable' && `⚠ unparseable — ${a.reason}`}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>"{line.raw}"</div>
    </li>
  );
}

export default function NextProduceClient({ initial }: { initial: NextOrderEvaluation }) {
  const [evaluation, setEvaluation] = useState<NextOrderEvaluation>(initial);
  const [notes, setNotes] = useState<string>('');
  const [filter, setFilter] = useState<FilterValue>('order');
  const [refreshing, setRefreshing] = useState(false);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string; total_cases: number; total_dollars: number; line_count: number } | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aiParse, setAiParse] = useState<{ lines: LlmParsedLine[]; totals: { cache_hits: number; llm_calls: number; total_cost_usd: number } } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const applyNotes = useCallback(async () => {
    setRefreshing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/buying/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setEvaluation(data as NextOrderEvaluation);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [notes]);

  const generateEmail = useCallback(async () => {
    setDraftLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/orders/produce/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setEmailDraft(data);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftLoading(false);
    }
  }, [notes]);

  const parseAi = useCallback(async () => {
    setAiLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/orders/produce/parse-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      setAiParse(data);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }, [notes]);

  const filtered = useMemo(() => {
    const rows = evaluation.rows;
    switch (filter) {
      case 'order':  return rows.filter((r) => r.suggested_cases > 0);
      case 'buy':    return rows.filter((r) => r.verdict === 'BUY');
      case 'skip':   return rows.filter((r) => r.verdict === 'SKIP');
      case 'review': return rows.filter((r) => r.verdict === 'REVIEW');
      default:       return rows;
    }
  }, [evaluation.rows, filter]);

  const totals = evaluation.totals;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
            Next Produce Order
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
            Inventory-driven Albert's order suggestion. Velocity excludes loss-tally units; profit-center verdict per SKU.
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
            Inventory as of: {evaluation.inventory_snapshot_ts ? new Date(evaluation.inventory_snapshot_ts).toLocaleString('en-US', { timeZone: 'America/New_York' }) : '—'}
          </p>
        </div>
        <div className="text-right text-xs" style={{ color: 'var(--sage)' }}>
          <div className="font-bold" style={{ color: 'var(--cream)' }}>
            {totals.suggested_cases_total} cases · {fmtDollars(totals.suggested_dollars_total)}
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            {totals.buy_count} BUY · {totals.review_count} REVIEW · {totals.skip_count} SKIP · {totals.items} total
          </div>
        </div>
      </div>

      {evaluation.error ? (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(196,146,58,0.12)', border: '1px solid rgba(196,146,58,0.35)', color: '#c4923a' }}>
          <strong>Degraded mode</strong>: {evaluation.error}. Suggestions may be incomplete. Refresh after the upstream table populates.
        </div>
      ) : null}
      {errorMsg ? (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(176,96,96,0.12)', border: '1px solid rgba(176,96,96,0.3)', color: '#b06060' }}>
          {errorMsg}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Notes textarea */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
              Notes (one action per line)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder={`add 2 cs asparagus
skip cilantro
s/o Blake 2 chicken thighs
note romaine: keep whole heads`}
              className="mt-1 w-full rounded-md px-3 py-2 text-sm font-mono"
              style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)', minHeight: '120px' }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={applyNotes}
                disabled={refreshing}
                className="rounded-md px-4 py-2 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                style={{ background: 'var(--gold)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
              >
                {refreshing ? 'Applying…' : 'Apply Notes'}
              </button>
              <button
                onClick={parseAi}
                disabled={aiLoading}
                className="rounded-md px-4 py-2 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                style={{ background: 'var(--accent-pink, #b06b8c)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
                title="Parse notes with Claude (handles free-form human language)"
              >
                {aiLoading ? 'Parsing…' : 'Parse with AI'}
              </button>
              <button
                onClick={generateEmail}
                disabled={draftLoading}
                className="rounded-md px-4 py-2 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                style={{ background: 'var(--sage)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
              >
                {draftLoading ? 'Generating…' : "Generate Albert's Email"}
              </button>
              <span className="text-[10px] self-center" style={{ color: 'var(--text-muted)' }}>
                Grammar: <code>add N item</code> · <code>skip item</code> · <code>s/o customer N item</code> · <code>note item: text</code>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Parsed actions panel */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                Parsed Actions
              </p>
              {aiParse ? (
                <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  AI · {aiParse.totals.llm_calls} call{aiParse.totals.llm_calls === 1 ? '' : 's'} · {aiParse.totals.cache_hits} cached · ${aiParse.totals.total_cost_usd.toFixed(4)}
                </span>
              ) : null}
            </div>
            {aiParse ? (
              <ul className="mt-2 space-y-1.5 text-xs" style={{ color: 'var(--cream)' }}>
                {aiParse.lines.map((l, i) => <AiActionItem key={i} line={l} />)}
              </ul>
            ) : evaluation.parsed_notes.length === 0 ? (
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>No notes parsed yet. Try the <strong>Parse with AI</strong> button.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-xs" style={{ color: 'var(--cream)' }}>
                {evaluation.parsed_notes.map((a: ParsedAction, i) => (
                  <li key={i} style={{ color: a.kind === 'noop' ? '#b06060' : 'var(--cream)' }}>
                    {a.kind === 'noop' ? `⚠ "${a.raw}" — ${a.reason}` : (
                      <>
                        <span style={{ color: 'var(--gold)', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.1em' }}>{a.kind}</span>{' '}
                        {a.kind === 'add' && `${a.qty} ${a.unit} ${a.itemName}`}
                        {a.kind === 'skip' && a.itemName}
                        {a.kind === 'so' && `${a.customer} · ${a.qty} ${a.unit} ${a.itemName}`}
                        {a.kind === 'note' && `${a.itemName}: ${a.text}`}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Show</span>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className="rounded px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
            style={{
              background: filter === f.value ? 'var(--gold)' : 'var(--forest-mid)',
              color: filter === f.value ? 'var(--forest-darkest)' : 'var(--sage)',
              fontFamily: 'var(--font-josefin)',
            }}
          >{f.label}</button>
        ))}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
          showing {filtered.length} of {evaluation.rows.length}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                  {['#','Item','OH','30d Vel','7d Vel','Lost','Days','Truck','Cases','Cost','Src','Retail','Margin','Verdict','Override'].map((h) => (
                    <th key={h} className="sticky top-0 px-2 py-2 text-left font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '9px', background: 'var(--forest)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={15} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No items match this filter.</td></tr>
                ) : filtered.map((r, i) => {
                  const v = verdictColor(r.verdict);
                  const finalCases = r.override_cases != null ? r.override_cases : r.suggested_cases;
                  return (
                    <tr key={r.thrive_item_id} style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                      <td className="px-2 py-1.5 align-top" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td className="px-2 py-1.5 align-top">
                        <div className="flex items-start gap-1.5">
                          <span className="inline-block h-2 w-2 rounded-full mt-1 flex-shrink-0" style={{ background: urgencyColor(r.days_of_supply) }} />
                          <div>
                            <div className="font-medium" style={{ color: 'var(--cream)' }}>{r.name}</div>
                            {r.sku ? <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{r.sku}{r.is_core_staple ? ' · staple' : ''}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: 'var(--cream)' }}>{fmt(r.current_on_hand)}</td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: 'var(--sage)' }}>{fmt(r.velocity_per_week_clean)}</td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: 'var(--sage)' }}>{fmt(r.velocity_per_day_7d_clean * 7)}</td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: r.units_lost_30d > 0 ? '#c4923a' : 'var(--text-muted)' }}>{r.units_lost_30d > 0 ? fmt(r.units_lost_30d) : '—'}</td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: urgencyColor(r.days_of_supply) }}>{fmt(r.days_of_supply)}</td>
                      <td className="px-2 py-1.5 align-top" style={{ color: 'var(--cream)' }}>
                        {fmtDate(r.next_truck_date)}
                        {r.target_dos != null ? <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>tgt {r.target_dos}d</div> : null}
                      </td>
                      <td className="px-2 py-1.5 text-right align-top">
                        <span className="font-semibold" style={{ color: finalCases > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
                          {finalCases > 0 ? `${finalCases} cs` : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: 'var(--cream)' }}>{fmtDollars(r.unit_cost_dollars)}</td>
                      <td className="px-2 py-1.5 align-top">
                        <span
                          className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                          title={costTitle(r.cost_source)}
                          style={costChipStyle(r.cost_source)}
                        >
                          {costShort(r.cost_source)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: 'var(--cream)' }}>{fmtDollars(r.sticky_retail_dollars)}</td>
                      <td className="px-2 py-1.5 text-right align-top" style={{ color: (r.expected_margin_pct ?? 0) >= 0.40 ? '#7aaa62' : '#b06060' }}>{fmtPct(r.expected_margin_pct)}</td>
                      <td className="px-2 py-1.5 align-top">
                        <span className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest" style={{ background: v.bg, color: v.fg, fontFamily: 'var(--font-josefin)' }}>{r.verdict}</span>
                        {r.verdict_reason ? <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{r.verdict_reason}</div> : null}
                      </td>
                      <td className="px-2 py-1.5 align-top" style={{ color: r.override_reason ? 'var(--gold)' : 'var(--text-muted)' }}>
                        {r.override_reason ?? '—'}
                        {r.override_note ? <div className="text-[9px]" style={{ color: 'var(--sage)' }}>"{r.override_note}"</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Email draft panel */}
      {emailDraft ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                Email Draft — {emailDraft.line_count} lines · {emailDraft.total_cases} cases · {fmtDollars(emailDraft.total_dollars)}
              </p>
              <button
                onClick={() => { navigator.clipboard.writeText(emailDraft.body); }}
                className="rounded-md px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
                style={{ background: 'var(--gold)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
              >
                Copy body
              </button>
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--sage)' }}>
              Subject: <span className="font-mono" style={{ color: 'var(--cream)' }}>{emailDraft.subject}</span>
            </p>
            <pre
              className="mt-3 rounded-md p-3 text-xs whitespace-pre-wrap font-mono overflow-auto"
              style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)', maxHeight: '40vh' }}
            >{emailDraft.body}</pre>
            <p className="mt-2 text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
              v1: copy-paste into Gmail (compose new mail to yourself, paste body). v1.1 will SMTP-send directly via lobstermaine27@gmail.com.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
