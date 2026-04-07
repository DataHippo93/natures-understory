'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SavedView {
  id: string;
  name: string;
  description?: string | null;
  query_sql: string;
  is_shared: boolean;
}

interface QueryRow {
  [key: string]: unknown;
}

interface QueryInterfaceProps {
  defaultSql: string;
  savedViews: SavedView[];
}

// Visual query builder state
interface QueryBuilder {
  table: string;
  groupBy: string;
  metric: string;
  startDate: string;
  endDate: string;
}

const TEMPLATES = [
  {
    label: 'Revenue by Category',
    sql: (start: string, end: string) =>
      `SELECT\n  category_name,\n  ROUND(SUM(net_price_cents) / 100.0, 2) AS revenue,\n  SUM(quantity) AS units_sold\nFROM sales_line_items\nWHERE sale_date BETWEEN '${start}' AND '${end}'\nGROUP BY category_name\nORDER BY revenue DESC`,
  },
  {
    label: 'Top Items by Revenue',
    sql: (start: string, end: string) =>
      `SELECT\n  item_name,\n  category_name,\n  ROUND(SUM(net_price_cents) / 100.0, 2) AS revenue,\n  SUM(quantity) AS units_sold\nFROM sales_line_items\nWHERE sale_date BETWEEN '${start}' AND '${end}'\nGROUP BY item_name, category_name\nORDER BY revenue DESC\nLIMIT 50`,
  },
  {
    label: 'Daily Revenue',
    sql: (start: string, end: string) =>
      `SELECT\n  sale_date,\n  ROUND(SUM(net_price_cents) / 100.0, 2) AS revenue,\n  COUNT(DISTINCT order_id) AS orders\nFROM sales_line_items\nWHERE sale_date BETWEEN '${start}' AND '${end}'\nGROUP BY sale_date\nORDER BY sale_date`,
  },
  {
    label: 'Revenue by Hour',
    sql: (start: string, end: string) =>
      `SELECT\n  sale_hour,\n  ROUND(AVG(daily_revenue), 2) AS avg_hourly_revenue\nFROM (\n  SELECT sale_date, sale_hour,\n    SUM(net_price_cents) / 100.0 AS daily_revenue\n  FROM sales_line_items\n  WHERE sale_date BETWEEN '${start}' AND '${end}'\n  GROUP BY sale_date, sale_hour\n) sub\nGROUP BY sale_hour\nORDER BY sale_hour`,
  },
];

export function QueryInterface({ defaultSql, savedViews }: QueryInterfaceProps) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const [sql, setSql] = useState(defaultSql);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<QueryRow[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);

  // Save view state
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveShared, setSaveShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Builder state
  const [builder, setBuilder] = useState<QueryBuilder>({
    table: 'sales_line_items',
    groupBy: 'category_name',
    metric: 'revenue',
    startDate: thirtyDaysAgo,
    endDate: today,
  });

  const buildSqlFromVisual = useCallback(() => {
    const metricExpr =
      builder.metric === 'revenue'
        ? 'ROUND(SUM(net_price_cents) / 100.0, 2) AS revenue'
        : builder.metric === 'units'
        ? 'SUM(quantity) AS units_sold'
        : 'COUNT(*) AS line_items';

    return `SELECT\n  ${builder.groupBy},\n  ${metricExpr}\nFROM ${builder.table}\nWHERE sale_date BETWEEN '${builder.startDate}' AND '${builder.endDate}'\nGROUP BY ${builder.groupBy}\nORDER BY 2 DESC\nLIMIT 50`;
  }, [builder]);

  const applyBuilder = () => {
    setSql(buildSqlFromVisual());
  };

  const runQuery = async () => {
    setRunning(true);
    setError(null);
    setRows(null);
    setColumns([]);
    try {
      const res = await fetch('/api/reports/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const data = await res.json() as { rows?: QueryRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Query failed');
      const resultRows = (data.rows as QueryRow[]) ?? [];
      setRows(resultRows);
      setColumns(resultRows.length > 0 ? Object.keys(resultRows[0]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const saveView = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/reports/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName,
          description: saveDescription || undefined,
          query_sql: sql,
          is_shared: saveShared,
        }),
      });
      const data = await res.json() as { view?: unknown; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setSaveMsg('Saved!');
      setShowSave(false);
      setSaveName('');
      setSaveDescription('');
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const loadView = (view: SavedView) => {
    setSql(view.query_sql);
    setRows(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      {/* Visual query builder */}
      <Card>
        <CardHeader>
          <CardTitle>Query Builder</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
                Group By
              </label>
              <select
                value={builder.groupBy}
                onChange={(e) => setBuilder((b) => ({ ...b, groupBy: e.target.value }))}
                className="rounded px-3 py-1.5 text-xs outline-none"
                style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
              >
                <option value="category_name">Category</option>
                <option value="item_name">Item</option>
                <option value="sale_date">Date</option>
                <option value="sale_hour">Hour</option>
                <option value="pos_source">POS Source</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
                Metric
              </label>
              <select
                value={builder.metric}
                onChange={(e) => setBuilder((b) => ({ ...b, metric: e.target.value }))}
                className="rounded px-3 py-1.5 text-xs outline-none"
                style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
              >
                <option value="revenue">Revenue ($)</option>
                <option value="units">Units Sold</option>
                <option value="count">Line Items</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
                Start Date
              </label>
              <input
                type="date"
                value={builder.startDate}
                onChange={(e) => setBuilder((b) => ({ ...b, startDate: e.target.value }))}
                className="rounded px-3 py-1.5 text-xs outline-none"
                style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
                End Date
              </label>
              <input
                type="date"
                value={builder.endDate}
                onChange={(e) => setBuilder((b) => ({ ...b, endDate: e.target.value }))}
                className="rounded px-3 py-1.5 text-xs outline-none"
                style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
              />
            </div>
            <button
              onClick={applyBuilder}
              className="rounded px-3 py-1.5 text-xs font-bold"
              style={{ background: 'var(--forest-hover)', color: 'var(--gold)', border: '1px solid var(--gold)', fontFamily: 'var(--font-josefin)' }}
            >
              Generate SQL
            </button>
          </div>

          {/* Templates */}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest self-center" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>
              Templates:
            </span>
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                onClick={() => setSql(t.sql(builder.startDate, builder.endDate))}
                className="rounded px-2.5 py-1 text-[10px] font-semibold transition-all"
                style={{ background: 'var(--forest-mid)', color: 'var(--sage)', border: '1px solid var(--forest-light)', fontFamily: 'var(--font-josefin)' }}
              >
                {t.label}
              </button>
            ))}
            {savedViews.map((v) => (
              <button
                key={v.id}
                onClick={() => loadView(v)}
                className="rounded px-2.5 py-1 text-[10px] font-semibold transition-all"
                style={{ background: 'rgba(196,146,58,0.1)', color: 'var(--gold)', border: '1px solid rgba(196,146,58,0.3)', fontFamily: 'var(--font-josefin)' }}
              >
                {v.name}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SQL editor */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>SQL Editor</CardTitle>
            <div className="flex items-center gap-2">
              {saveMsg && (
                <span className="text-xs" style={{ color: saveMsg === 'Saved!' ? '#7aaa62' : '#b06060' }}>
                  {saveMsg}
                </span>
              )}
              <button
                onClick={() => setShowSave((s) => !s)}
                className="rounded px-2.5 py-1 text-xs font-bold"
                style={{ background: 'var(--forest-mid)', color: 'var(--sage)', border: '1px solid var(--forest-light)', fontFamily: 'var(--font-josefin)' }}
              >
                Save View
              </button>
              <button
                onClick={runQuery}
                disabled={running}
                className="rounded px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                style={{ background: 'var(--gold)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
              >
                {running ? 'Running...' : 'Run Query'}
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {showSave && (
            <div className="mb-4 rounded-lg p-4 space-y-3" style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)' }}>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>Save This View</p>
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-48">
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Name</label>
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="My revenue report"
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
                  />
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}>Description</label>
                  <input
                    type="text"
                    value={saveDescription}
                    onChange={(e) => setSaveDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{ background: 'var(--forest-mid)', color: 'var(--cream)', border: '1px solid var(--forest-light)' }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--sage)' }}>
                  <input
                    type="checkbox"
                    checked={saveShared}
                    onChange={(e) => setSaveShared(e.target.checked)}
                    className="rounded"
                  />
                  Share with all users
                </label>
                <button
                  onClick={saveView}
                  disabled={saving || !saveName.trim()}
                  className="rounded px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                  style={{ background: 'var(--gold)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setShowSave(false)}
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded-lg p-4 text-xs font-mono outline-none resize-y"
            style={{
              background: 'var(--forest-darkest)',
              border: '1px solid var(--forest-mid)',
              color: 'var(--cream)',
              lineHeight: '1.6',
              minHeight: '200px',
            }}
            placeholder="SELECT * FROM sales_line_items LIMIT 10"
          />
        </CardContent>
      </Card>

      {/* Results */}
      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(176,96,96,0.1)', border: '1px solid rgba(176,96,96,0.3)', color: '#b06060' }}>
          <strong>Query Error:</strong> {error}
        </div>
      )}

      {rows !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {rows.length} row{rows.length !== 1 ? 's' : ''} returned
            </p>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {rows.length === 0 ? (
              <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No results</p>
            ) : (
              <table className="w-full text-xs min-w-max">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-left font-bold uppercase tracking-widest whitespace-nowrap"
                        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--forest-mid)' : undefined }}
                    >
                      {columns.map((col) => {
                        const val = row[col];
                        const isNum = typeof val === 'number';
                        return (
                          <td
                            key={col}
                            className="px-4 py-2.5 font-mono whitespace-nowrap"
                            style={{ color: isNum ? '#c4923a' : 'var(--cream)' }}
                          >
                            {val === null ? (
                              <span style={{ color: 'var(--forest-light)' }}>null</span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
