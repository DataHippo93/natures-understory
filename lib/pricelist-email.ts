// Tier pricelist generation: HTML + plain-text email body + deduped BCC list.
// v7.5 (2026-07-07): four-column layout — Item / Retail / Your price / Save% —
// so recipients see their discount vs retail. Item set = wholesale-active
// variants that have a NON-NULL tier price (blank tier price = customer pays
// retail = omitted from this tier's email). Recipients = subscribed customers
// on Company Locations assigned to the tier's catalog (see lib/wholesale.ts).
//
// This module builds a DRAFT that the tool renders in a modal. Clark or Daniel
// copies BCC + subject + body and sends from their own inbox — Shopify's
// transactional email templates are NOT involved. If a Shopify-side notification
// ever needs to look like this, it's a separate template in Shopify Admin →
// Settings → Notifications.
//
// IMPORTANT: recipients go in BCC only, and the tier is never named in the
// subject/body — a Tier 1 customer should never learn tiers exist.

import { loadGrid, loadRecipients, type Tier } from './wholesale';

export interface PricelistDraft {
  subject: string;
  htmlBody: string;
  textBody: string; // v7.5: plain-text mirror of htmlBody, same columns
  bcc: string[];
  itemCount: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Line {
  item: string;
  variant: string;
  retail: number;
  price: number;
  savePct: number; // rounded whole-percent; 0 if tier ≥ retail
}

export async function generatePricelistDraft(tier: Tier): Promise<PricelistDraft> {
  const [rows, list] = await Promise.all([loadGrid(), loadRecipients()]);

  const lines: Line[] = rows
    .filter((r) => {
      const t = tier === 't1' ? r.tier1 : r.tier2;
      return r.wholesaleActive && t !== null && t !== '';
    })
    .map((r) => {
      const retail = Number(r.retail) || 0;
      const price = Number(tier === 't1' ? r.tier1 : r.tier2);
      const savePct =
        retail > 0 && retail > price ? Math.round(((retail - price) / retail) * 100) : 0;
      return {
        item: r.productTitle,
        variant: r.variantTitle === 'Default Title' ? '' : r.variantTitle,
        retail,
        price,
        savePct,
      };
    });

  const bcc = [
    ...new Set(
      list.recipients
        .filter((c) => !c.optedOut && (tier === 't1' ? c.t1 : c.t2))
        .map((c) => c.email)
    ),
  ];

  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // ---------- HTML ----------

  const rowsHtml = lines
    .map(
      (i, idx) => `
      <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f7f7f2'};">
        <td style="padding:6px 12px;border-bottom:1px solid #e5e5e0;">
          ${escapeHtml(i.item)}${i.variant ? ` <span style="color:#666;">· ${escapeHtml(i.variant)}</span>` : ''}
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e5e0;text-align:right;color:#888;text-decoration:line-through;">$${i.retail.toFixed(2)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e5e0;text-align:right;font-weight:bold;color:#2C4A2B;">$${i.price.toFixed(2)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e5e0;text-align:right;color:#2C4A2B;">${i.savePct > 0 ? i.savePct + '%' : '—'}</td>
      </tr>`
    )
    .join('');

  const htmlBody = `
  <div style="font-family:Georgia,serif;max-width:720px;margin:0 auto;color:#2b2b2b;">
    <h2 style="margin-bottom:0;">LoPro Wholesale Price List</h2>
    <p style="margin-top:4px;color:#666;">${dateStr} · prices subject to seasonal availability</p>
    <table style="border-collapse:collapse;width:100%;font-family:Calibri,Arial,sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#2C4A2B;color:#ffffff;text-align:left;">
          <th style="padding:8px 12px;">Item</th>
          <th style="padding:8px 12px;text-align:right;">Retail</th>
          <th style="padding:8px 12px;text-align:right;">Your price</th>
          <th style="padding:8px 12px;text-align:right;">Save</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#666;">
      To order, reply to this email or order online with your wholesale account.
    </p>
  </div>`;

  // ---------- Plain text (symmetric columns) ----------

  const labels = lines.map((l) => (l.variant ? l.item + ' · ' + l.variant : l.item));
  const nameCol = Math.max(20, 'Item'.length, ...labels.map((s) => s.length));
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const padL = (s: string, w: number) => ' '.repeat(Math.max(0, w - s.length)) + s;

  const header = 'LoPro Wholesale Price List';
  const subheader = dateStr + ' · prices subject to seasonal availability';
  const th =
    pad('Item', nameCol) +
    '   ' +
    padL('Retail', 9) +
    '   ' +
    padL('Your price', 11) +
    '   ' +
    padL('Save', 5);
  const sep = '-'.repeat(th.length);

  const textRows = lines.map((l, i) => {
    return (
      pad(labels[i], nameCol) +
      '   ' +
      padL('$' + l.retail.toFixed(2), 9) +
      '   ' +
      padL('$' + l.price.toFixed(2), 11) +
      '   ' +
      padL(l.savePct > 0 ? l.savePct + '%' : '—', 5)
    );
  });

  const textBody = [
    header,
    subheader,
    '',
    th,
    sep,
    ...textRows,
    '',
    'To order, reply to this email or order online with your wholesale account.',
  ].join('\n');

  return {
    subject: `LoPro Wholesale Price List — ${dateStr}`,
    htmlBody,
    textBody,
    bcc,
    itemCount: lines.length,
  };
}
