// /orders — list past Albert's orders. Read-only history dashboard.
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface OrderRow {
  order_date: string;
  status: string;
  n_lines: number | null;
  subtotal_cents: number | null;
  subtotal_if_bids_cents: number | null;
  invoice_number: string | null;
  invoice_received_at: string | null;
  thrive_po_id: string | null;
  sent_at: string | null;
  rehearsal: boolean;
}

function dollars(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    draft:       { label: 'Draft',       color: 'bg-amber-100 text-amber-800' },
    review:      { label: 'In Review',   color: 'bg-amber-100 text-amber-800' },
    sent:        { label: 'Sent',        color: 'bg-blue-100 text-blue-800' },
    received:    { label: 'Received',    color: 'bg-emerald-100 text-emerald-800' },
    reconciled:  { label: 'Reconciled',  color: 'bg-emerald-100 text-emerald-800' },
    cancelled:   { label: 'Cancelled',   color: 'bg-zinc-100 text-zinc-700' },
  };
  return map[status] ?? { label: status, color: 'bg-zinc-100 text-zinc-700' };
}

export default async function OrdersPage() {
  const admin = createAdminClient();
  if (!admin) {
    return <div className="p-6">Database not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.</div>;
  }

  const { data, error } = await admin
    .from('alberts_orders')
    .select('order_date,status,n_lines,subtotal_cents,subtotal_if_bids_cents,invoice_number,invoice_received_at,thrive_po_id,sent_at,rehearsal')
    .order('order_date', { ascending: false })
    .limit(50);

  if (error) {
    return <div className="p-6 text-red-700">DB error: {error.message}</div>;
  }
  const orders: OrderRow[] = data ?? [];

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Albert&apos;s Orders</h1>
        <p className="text-sm text-zinc-500">{orders.length} order{orders.length === 1 ? '' : 's'}</p>
      </div>

      {orders.length === 0 ? (
        <div className="border border-zinc-200 bg-white rounded-md p-8 text-center text-zinc-500">
          No orders ingested yet. Apply migration 003 + 004 + 005, then run a Mon/Thu morning order.
        </div>
      ) : (
        <div className="border border-zinc-200 bg-white rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Lines</th>
                <th className="px-4 py-2.5 text-right">Subtotal</th>
                <th className="px-4 py-2.5 text-right">If bids</th>
                <th className="px-4 py-2.5">Invoice</th>
                <th className="px-4 py-2.5">PO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {orders.map((o) => {
                const badge = statusBadge(o.status);
                return (
                  <tr key={o.order_date} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5 font-mono">
                      <Link href={`/orders/${o.order_date}`} className="text-blue-700 hover:underline">
                        {o.order_date}
                      </Link>
                      {o.rehearsal && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700">rehearsal</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>{badge.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">{o.n_lines ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{dollars(o.subtotal_cents)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-500">{dollars(o.subtotal_if_bids_cents)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{o.invoice_number ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{o.thrive_po_id ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
