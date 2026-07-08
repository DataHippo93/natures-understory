// Tier pricelist generation: HTML email body + deduped BCC recipient list.
// Item set = all wholesale_active items; price = tier FIXED price if set,
// else retail. Recipients = customers tagged wholesale-list-<tier>.
// IMPORTANT: recipients go in BCC only, and the tier is never named in the
// subject/body — a Tier 1 customer should never learn tiers exist.

import { loadGrid, loadRecipients, type Tier } from './wholesale';

export interface PricelistDraft {
  subject: string;
  htmlBody: string;
  bcc: string[];
  itemCount: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function generatePricelistDraft(tier: Tier): Promise<PricelistDraft> {
  const [rows, recipients] = await Promise.all([loadGrid(), loadRecipients()]);

  const items = rows
    .filter((r) => r.wholesaleActive)
    .map((r) => ({
      item: r.productTitle,
      variant: r.variantTitle === 'Default Title' ? '' : r.variantTitle,
      price: Number(tier === 't1' ? (r.tier1 ?? r.retail) : (r.tier2 ?? r.retail)).toFixed(2),
    }));

  const bcc = [
    ...new Set(
      recipients.filter((c) => (tier === 't1' ? c.t1 : c.t2)).map((c) => c.email.toLowerCase())
    ),
  ];

  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const rowsHtml = items
    .map(
      (i, idx) => `
      <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f7f7f2'};">
        <td style="padding:6px 12px;border-bottom:1px solid #e5e5e0;">${escapeHtml(i.item)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e5e0;color:#666;">${escapeHtml(i.variant)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e5e0;text-align:right;">$${i.price}</td>
      </tr>`
    )
    .join('');

  const htmlBody = `
  <div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;color:#2b2b2b;">
    <h2 style="margin-bottom:0;">LoPro Wholesale Price List</h2>
    <p style="margin-top:4px;color:#666;">${dateStr} · prices subject to seasonal availability</p>
    <table style="border-collapse:collapse;width:100%;font-family:Calibri,Arial,sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#2C4A2B;color:#ffffff;text-align:left;">
          <th style="padding:8px 12px;">Item</th>
          <th style="padding:8px 12px;">Unit</th>
          <th style="padding:8px 12px;text-align:right;">Price</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#666;">
      To order, reply to this email or order online with your wholesale account.
    </p>
  </div>`;

  return {
    subject: `LoPro Wholesale Price List — ${dateStr}`,
    htmlBody,
    bcc,
    itemCount: items.length,
  };
}
