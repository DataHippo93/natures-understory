// Builds the canonical Albert's order email (5/21 format) from the
// evaluated next-order rows.

import type { NextOrderRow, NextOrderEvaluation } from './next-order';

export interface OrderEmailDraft {
  subject: string;
  body: string;
  recipient: string;       // Cowork agent -> Clark; Jasmia is the forward destination
  order_date: string;
  total_cases: number;
  total_dollars: number;
  line_count: number;
}

function formatMonthDay(iso: string): string {
  // iso = YYYY-MM-DD ; output "M/D" (no leading zeros)
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

function lineQty(r: NextOrderRow): number {
  return r.override_cases != null ? r.override_cases : r.suggested_cases;
}

/** A 5-column markdown table that displays cleanly in Gmail too. */
function buildTable(rows: NextOrderRow[]): string {
  const lines = [
    '| SKU | Item | Qty | Pack | Notes |',
    '|-----|------|-----|------|-------|',
  ];
  for (const r of rows) {
    const qty = lineQty(r);
    if (qty <= 0) continue;
    const pack = r.units_per_case ? `${r.units_per_case} ct` : 'case';
    const notes: string[] = [];
    if (r.override_note) notes.push(r.override_note);
    if (r.override_kind === 'so') notes.push(`S/O ${r.override_so_customer ?? ''}`.trim());
    if (r.is_core_staple && qty > 0) notes.push('staple');
    lines.push(`| ${r.sku ?? '—'} | ${r.name} | ${qty} | ${pack} | ${notes.join('; ')} |`);
  }
  return lines.join('\n');
}

export function buildOrderEmail(eva: NextOrderEvaluation, opts: { orderDate?: string } = {}): OrderEmailDraft {
  // Pick order date: prefer first next_truck_date in the evaluation; else today
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const orderDate = opts.orderDate
    ?? eva.rows.find((r) => r.next_truck_date)?.next_truck_date
    ?? today;

  // Filter to lines we're actually ordering
  const lines = eva.rows.filter((r) => lineQty(r) > 0);
  const subject = `Order ${formatMonthDay(orderDate)}`;

  // Special-order rows surface under "Please also add"
  const soLines = lines.filter((r) => r.override_kind === 'so');

  const table = buildTable(lines);

  const soBlock = soLines.length === 0 ? '' : '\n\nPlease also add:\n' + soLines.map((r) => {
    const qty = lineQty(r);
    return `- ${qty} ${r.units_per_case ? `cs (${r.units_per_case}ct)` : 'cs'} ${r.name}${r.override_so_customer ? ` — S/O ${r.override_so_customer}` : ''}`;
  }).join('\n');

  const bodyMain =
`Hello!

Clark here ordering for Nature's Storehouse Canton.

${table}${soBlock}

If under minimum, please add bananas, yellow onions, and carrots to meet the threshold.

Thanks!
Clark`;

  const body =
`${bodyMain}

─── FORWARD TO JASMIA BELOW ───

${bodyMain}`;

  const total_cases = lines.reduce((s, r) => s + lineQty(r), 0);
  const total_dollars = lines.reduce((s, r) => {
    const qty = lineQty(r);
    if (qty <= 0 || !r.unit_cost_dollars || !r.units_per_case) return s;
    return s + qty * r.units_per_case * r.unit_cost_dollars;
  }, 0);

  return {
    subject,
    body,
    recipient: 'cmaine@ycconsulting.biz',
    order_date: orderDate,
    total_cases,
    total_dollars: Math.round(total_dollars * 100) / 100,
    line_count: lines.length,
  };
}
