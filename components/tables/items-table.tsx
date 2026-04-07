'use client';

interface ItemRow {
  item_name: string;
  category_name: string | null;
  revenue: number;
  items_sold: number;
}

interface ItemsTableProps {
  rows: ItemRow[];
}

export function ItemsTable({ rows }: ItemsTableProps) {
  const maxRevenue = rows[0]?.revenue ?? 1;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
          {['#', 'Item', 'Category', 'Revenue', 'Units Sold', 'Avg Price'].map((h) => (
            <th
              key={h}
              className="px-4 py-3 text-left font-bold uppercase tracking-widest"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)', fontSize: '10px' }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const avgPrice = row.items_sold > 0 ? row.revenue / row.items_sold : 0;
          const barPct = maxRevenue > 0 ? (row.revenue / maxRevenue) * 100 : 0;
          return (
            <tr
              key={`${row.item_name}-${i}`}
              style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--forest-mid)' : undefined }}
            >
              <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
              <td className="px-4 py-2.5">
                <div>
                  <p className="font-medium" style={{ color: 'var(--cream)' }}>{row.item_name}</p>
                  <div className="mt-0.5 h-1 w-24 rounded-full overflow-hidden" style={{ background: 'var(--forest-mid)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${barPct}%`, background: 'var(--gold)', opacity: 0.7 }}
                    />
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5">
                {row.category_name ? (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'var(--forest-mid)', color: 'var(--sage)' }}
                  >
                    {row.category_name}
                  </span>
                ) : (
                  <span style={{ color: 'var(--forest-light)' }}>—</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-semibold" style={{ color: '#c4923a' }}>
                ${row.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-2.5" style={{ color: 'var(--sage)' }}>
                {row.items_sold.toLocaleString()}
              </td>
              <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                ${avgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
