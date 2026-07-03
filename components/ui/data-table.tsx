import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  /** Marks the row heading on mobile (usually the first identifying column). */
  primary?: boolean;
  /** Text alignment. */
  align?: 'left' | 'right' | 'center';
  /** Optional render fn; otherwise the row's key is rendered as string. */
  render?: (row: T, idx: number) => React.ReactNode;
  /** Hide entirely on narrow viewports (< md). */
  hideOnMobile?: boolean;
  /** Show only on narrow viewports. */
  mobileOnly?: boolean;
  /** Optional class for the cell. */
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Key extractor. Falls back to array index. */
  rowKey?: (row: T, idx: number) => string | number;
  /** "stack" (default) renders a card list on < md; "scroll" keeps the table
   * with horizontal scroll and a sticky first column. */
  mobileMode?: 'stack' | 'scroll';
  emptyMessage?: string;
  className?: string;
}

function alignClass(a?: 'left' | 'right' | 'center') {
  return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
}

/**
 * Responsive data table. On >=md it renders a normal <table>. On < md it
 * either stacks each row as a card of label / value pairs (default) or
 * enables horizontal scrolling with a sticky first column.
 *
 * Never wrap this in an extra scroll container — it handles overflow itself.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  mobileMode = 'stack',
  emptyMessage = 'No rows',
  className,
}: DataTableProps<T>) {
  const desktopCols = columns.filter((c) => !c.mobileOnly);
  const mobileCols = columns.filter((c) => !c.hideOnMobile);
  const primary = mobileCols.find((c) => c.primary) ?? mobileCols[0];
  const rest = mobileCols.filter((c) => c !== primary);

  const renderCell = (col: DataTableColumn<T>, row: T, idx: number): React.ReactNode => {
    if (col.render) return col.render(row, idx);
    const v = (row as Record<string, unknown>)[col.key];
    return v == null ? '—' : String(v);
  };

  if (rows.length === 0) {
    return (
      <div
        className="rounded-lg p-6 text-center text-sm"
        style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)', color: 'var(--text-muted)' }}
      >{emptyMessage}</div>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      {/* Desktop: real table */}
      <div
        className={cn('hidden md:block rounded-lg', mobileMode === 'scroll' ? '' : '')}
        style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                {desktopCols.map((c) => (
                  <th
                    key={c.key}
                    className={cn('px-4 py-3 font-bold uppercase tracking-widest whitespace-nowrap', alignClass(c.align))}
                    style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}
                  >{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row, i) : i}
                  style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--forest-mid)' : undefined }}
                >
                  {desktopCols.map((c) => (
                    <td
                      key={c.key}
                      className={cn('px-4 py-2.5', alignClass(c.align), c.className)}
                      style={{ color: 'var(--cream)' }}
                    >{renderCell(c, row, i)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: stacked card list */}
      {mobileMode === 'stack' ? (
        <ul className="md:hidden space-y-2">
          {rows.map((row, i) => (
            <li
              key={rowKey ? rowKey(row, i) : i}
              className="rounded-lg p-3"
              style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}
            >
              {primary && (
                <p
                  className="text-sm font-semibold break-words"
                  style={{ color: 'var(--cream)' }}
                >{renderCell(primary, row, i)}</p>
              )}
              <dl className="mt-2 grid gap-1.5">
                {rest.map((c) => (
                  <div key={c.key} className="flex items-baseline justify-between gap-2">
                    <dt
                      className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}
                    >{c.label}</dt>
                    <dd className="text-xs text-right min-w-0 break-words" style={{ color: 'var(--sage)' }}>
                      {renderCell(c, row, i)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="md:hidden overflow-x-auto rounded-lg"
          style={{ background: 'var(--forest)', border: '1px solid var(--forest-mid)' }}
        >
          <table className="min-w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                {mobileCols.map((c, ci) => (
                  <th
                    key={c.key}
                    className={cn(
                      'px-3 py-2 font-bold uppercase tracking-widest whitespace-nowrap',
                      alignClass(c.align),
                      ci === 0 ? 'sticky left-0 z-10' : '',
                    )}
                    style={{
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-josefin)',
                      fontSize: '10px',
                      background: ci === 0 ? 'var(--forest)' : undefined,
                    }}
                  >{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row, i) : i}
                  style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--forest-mid)' : undefined }}
                >
                  {mobileCols.map((c, ci) => (
                    <td
                      key={c.key}
                      className={cn('px-3 py-2', alignClass(c.align), ci === 0 ? 'sticky left-0 z-10' : '')}
                      style={{ color: 'var(--cream)', background: ci === 0 ? 'var(--forest)' : undefined }}
                    >{renderCell(c, row, i)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
