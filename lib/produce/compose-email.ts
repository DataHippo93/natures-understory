// Compose the supplier-facing produce order email.
//
// Layout mirrors what Clark has been sending manually:
//   - Greeting
//   - 4-column table: Qty | Item | Pack | Unit $ | Line $
//   - Bid section (prose) for BID rows
//   - Preorder followups
//   - Sign-off
// Notes routing:
//   - supplier_facing + both  → Notes column (supplier email)
//   - internal_po + both      → NOT in supplier email; goes to Thrive PO memo

interface LineForEmail {
  product_name: string;
  variant?: string | null;
  qty: number;
  pack?: string | null;
  units_per_case?: number | null;
  unit_cost_cents?: number | null;
  line_cents?: number | null;
  bid: boolean;
  bid_ask_cents?: number | null;
  decision: string;
  audience_note_supplier: string[];
  audience_note_internal: string[];
  audience_note_both: string[];
  is_preorder: boolean;
  matched_sku?: string | null;
}

interface Order {
  target_delivery_date: string | null;
  rvfm_piggyback: boolean;
  min_cents: number | null;
  subtotal_cents: number;
}

interface Vendor {
  display_name: string;
  contact_name: string | null;
}

function money(c: number | null | undefined): string {
  if (c == null) return '';
  return `$${(c / 100).toFixed(2)}`;
}

function fmtMonthDay(iso: string | null): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export interface ComposedEmail {
  subject: string;
  textBody: string;
  htmlBody: string;
}

export function composeSupplierEmail(order: Order, vendor: Vendor, lines: LineForEmail[]): ComposedEmail {
  const dateStr = fmtMonthDay(order.target_delivery_date);
  const vendorShort = vendor.display_name.replace(/'s$/, '').split(' ')[0];
  const subject = `${vendorShort} order ${dateStr}${order.rvfm_piggyback ? ' (+ RVFM)' : ''}`.trim();

  const orderRows = lines.filter((l) => l.decision === 'ORDER' && l.qty > 0);
  const bidRows = lines.filter((l) => l.decision === 'BID' && l.qty > 0);
  const preorderRows = orderRows.filter((l) => l.is_preorder);

  const supplierNote = (l: LineForEmail) => {
    const bullets = [...l.audience_note_both, ...l.audience_note_supplier];
    return bullets.join(' | ');
  };

  const packOf = (l: LineForEmail) => {
    if (l.pack) return l.pack;
    if (l.units_per_case) return `${l.units_per_case} ct`;
    return 'case';
  };

  // Plain-text 4-column table.
  const textLines: string[] = [
    `Hi ${vendor.contact_name ?? 'team'},`,
    '',
    `Clark here ordering for Nature's Storehouse Canton — for delivery ${order.target_delivery_date ?? 'TBD'}${order.rvfm_piggyback ? ' (RVFM piggyback on separate invoice, please)' : ''}.`,
    '',
    'Qty | Item | Pack | Unit $ | Line $ | Notes',
    '----|------|------|--------|--------|------',
  ];
  for (const l of orderRows) {
    textLines.push(`${l.qty} | ${l.product_name} | ${packOf(l)} | ${money(l.unit_cost_cents)} | ${money(l.line_cents)} | ${supplierNote(l)}`);
  }

  if (bidRows.length > 0) {
    textLines.push('', 'Also — these move at retail but the case cost is too tight to buy standard. Any flexibility?');
    for (const l of bidRows) {
      const askStr = l.bid_ask_cents != null ? money(l.bid_ask_cents) : '(open)';
      const noteStr = supplierNote(l);
      // "These move at $X can we do the case for $Y so we can move them fast?"
      const currentCase = money(l.unit_cost_cents);
      textLines.push(`  • ${l.product_name}${noteStr ? ` — ${noteStr}` : ''}: current case ${currentCase}, ask ${askStr}. These move fast — can we do the case for ${askStr} so we can keep the shelf full?`);
    }
  }

  if (preorderRows.length > 0) {
    textLines.push('', 'Preorder followups still open:');
    for (const l of preorderRows) {
      textLines.push(`  • ${l.product_name} — ${packOf(l)} (${l.qty} cs)`);
    }
  }

  textLines.push('', 'Thanks!', 'Clark');
  const textBody = textLines.join('\n');

  // Simple HTML — email-safe inline styles.
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c] ?? c);
  const tableRows = orderRows.map((l) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;font-variant-numeric:tabular-nums;">${l.qty}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;">${esc(l.product_name)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;">${esc(packOf(l))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${esc(money(l.unit_cost_cents))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${esc(money(l.line_cents))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;color:#666;font-size:12px;">${esc(supplierNote(l))}</td>
    </tr>`).join('');

  const bidHtml = bidRows.length === 0 ? '' : `
    <p style="margin-top:16px;">Also — these move at retail but the case cost is too tight to buy standard. Any flexibility?</p>
    <ul style="margin:6px 0 0 20px;">
      ${bidRows.map((l) => {
        const askStr = l.bid_ask_cents != null ? money(l.bid_ask_cents) : '(open)';
        const currentCase = money(l.unit_cost_cents);
        const noteStr = supplierNote(l);
        return `<li><strong>${esc(l.product_name)}</strong>${noteStr ? ` — ${esc(noteStr)}` : ''}: current case ${esc(currentCase)}, ask ${esc(askStr)}. These move fast — can we do the case for ${esc(askStr)} so we can keep the shelf full?</li>`;
      }).join('')}
    </ul>`;

  const preHtml = preorderRows.length === 0 ? '' : `
    <p style="margin-top:16px;">Preorder followups still open:</p>
    <ul style="margin:6px 0 0 20px;">
      ${preorderRows.map((l) => `<li>${esc(l.product_name)} — ${esc(packOf(l))} (${l.qty} cs)</li>`).join('')}
    </ul>`;

  const htmlBody = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">
      <p>Hi ${esc(vendor.contact_name ?? 'team')},</p>
      <p>Clark here ordering for Nature's Storehouse Canton — for delivery <strong>${esc(order.target_delivery_date ?? 'TBD')}</strong>${order.rvfm_piggyback ? ' (RVFM piggyback on separate invoice, please)' : ''}.</p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:8px;min-width:520px;">
        <thead>
          <tr style="background:#f0e8d8;">
            <th style="padding:6px 8px;text-align:right;">Qty</th>
            <th style="padding:6px 8px;text-align:left;">Item</th>
            <th style="padding:6px 8px;text-align:left;">Pack</th>
            <th style="padding:6px 8px;text-align:right;">Unit $</th>
            <th style="padding:6px 8px;text-align:right;">Line $</th>
            <th style="padding:6px 8px;text-align:left;">Notes</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${bidHtml}
      ${preHtml}
      <p style="margin-top:16px;">Thanks!<br>Clark</p>
    </div>`.trim();

  return { subject, textBody, htmlBody };
}
