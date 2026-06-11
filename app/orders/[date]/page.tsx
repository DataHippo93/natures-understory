// /orders/[date] — single order detail. Shows lines, audience-tagged
// notes, exceptions, and links to email/PO surfaces.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface OrderRow {
  order_date: string;
  status: string;
  rehearsal: boolean;
  ref_pricelist: string;
  n_lines: number | null;
  subtotal_cents: number | null;
  subtotal_if_bids_cents: number | null;
  invoice_number: string | null;
  thrive_po_id: string | null;
  open_questions: unknown[];
  availability_flags: unknown[];
  conv_unavoidable: unknown[];
  added_per_clark: unknown[];
  dropped: unknown[];
  email_subject: string | null;
  po_memo: string | null;
}

interface LineRow {
  line_no: number;
  alberts_sku: string;
  description: string;
  size: string | null;
  qty: number;
  case_price: number | null;
  bid_price: number | null;
  is_organic: boolean | null;
  is_so: boolean;
  so_customer: string | null;
  supplier_note_text: string | null;
  internal_po_text: string | null;
  rationale: string[] | null;
}

function dollars(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

export default async function OrderDetailPage({
  params,
}: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const admin = createAdminClient();
  if (!admin) {
    return <div className="p-6">Database not configured.</div>;
  }

  const { data: order } = await admin
    .from('alberts_orders')
    .select('*')
    .eq('order_date', date)
    .maybeSingle();

  if (!order) notFound();
  const o = order as OrderRow;

  const { data: lineData } = await admin
    .from('alberts_order_lines')
    .select('line_no,alberts_sku,description,size,qty,case_price,bid_price,is_organic,is_so,so_customer,supplier_note_text,internal_po_text,rationale')
    .eq('order_date', date)
    .order('line_no', { ascending: true });
  const lines = (lineData ?? []) as LineRow[];

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-blue-700 hover:underline">&larr; Back to orders</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">
          Order {o.order_date}
          {o.rehearsal && <span className="ml-3 text-sm uppercase tracking-wide text-amber-700">rehearsal</span>}
        </h1>
        <div className="text-sm text-zinc-600 mt-1 flex gap-4">
          <span>Status: <span className="font-medium">{o.status}</span></span>
          <span>Ref pricelist: {o.ref_pricelist}</span>
          {o.invoice_number && <span>Invoice {o.invoice_number}</span>}
          {o.thrive_po_id && <span>PO {o.thrive_po_id}</span>}
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Lines" value={o.n_lines?.toString() ?? '—'} />
        <Stat label="Subtotal" value={dollarsFromCents(o.subtotal_cents)} />
        <Stat label="If bids accepted" value={dollarsFromCents(o.subtotal_if_bids_cents)} />
      </div>

      {/* Exception buckets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExceptionBlock title="Open questions" items={o.open_questions} />
        <ExceptionBlock title="Availability flags" items={o.availability_flags} />
        <ExceptionBlock title="Added per Clark" items={o.added_per_clark} />
        <ExceptionBlock title="Dropped" items={o.dropped} />
        <ExceptionBlock title="Conventional unavoidable" items={o.conv_unavoidable} />
      </div>

      {/* Lines table */}
      <div className="border border-zinc-200 bg-white rounded-md overflow-hidden">
        <div className="px-4 py-2 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200">
          Lines ({lines.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Case $</th>
                <th className="px-4 py-2 text-right">Bid</th>
                <th className="px-4 py-2">Supplier note</th>
                <th className="px-4 py-2">Internal PO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {lines.map((l) => (
                <tr key={l.line_no} className="align-top">
                  <td className="px-4 py-2 text-xs text-zinc-400">{l.line_no}</td>
                  <td className="px-4 py-2 font-mono text-xs">{l.alberts_sku}</td>
                  <td className="px-4 py-2">
                    <div>{l.description}</div>
                    {l.size && <div className="text-xs text-zinc-500">{l.size}</div>}
                    {l.is_so && (
                      <div className="text-xs text-purple-700 mt-0.5">
                        S/O{l.so_customer ? `: ${l.so_customer}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{l.qty}</td>
                  <td className="px-4 py-2 text-right font-mono">{dollars(l.case_price)}</td>
                  <td className="px-4 py-2 text-right font-mono text-amber-700">{dollars(l.bid_price)}</td>
                  <td className="px-4 py-2 text-xs">{l.supplier_note_text || <span className="text-zinc-400">—</span>}</td>
                  <td className="px-4 py-2 text-xs text-zinc-600">{l.internal_po_text || <span className="text-zinc-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Email + PO surfaces */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Email">
          <div className="text-xs text-zinc-500 mb-1">Subject</div>
          <div className="text-sm font-mono mb-3">{o.email_subject ?? '—'}</div>
          <a href={`/api/orders/${date}/email`} className="text-sm text-blue-700 hover:underline">Download .eml</a>
        </Card>
        <Card title="Thrive PO memo">
          <div className="text-sm whitespace-pre-wrap text-zinc-700">{o.po_memo ?? '—'}</div>
        </Card>
      </div>
    </div>
  );
}

function dollarsFromCents(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-200 bg-white rounded-md p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 bg-white rounded-md">
      <div className="px-4 py-2 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ExceptionBlock({ title, items }: { title: string; items: unknown[] }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <div className="border border-zinc-200 bg-white rounded-md">
      <div className="px-4 py-2 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-200">{title}</div>
      <ul className="p-4 space-y-1.5 text-sm list-disc list-inside marker:text-zinc-400">
        {list.map((it, i) => (
          <li key={i}>{typeof it === 'string' ? it : JSON.stringify(it)}</li>
        ))}
      </ul>
    </div>
  );
}
