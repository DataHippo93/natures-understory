// Wholesale catalog-publication self-heal cron (v7.7.11).
//
// Runs nightly. For each tier price list, computes the set of parent
// products that have at least one priced variant, checks each against
// the tier's catalog publication, and publishes any that are missing.
//
// Never unpublishes here — that's a destructive action and belongs to
// the operator-driven toggle-off path. This route only *adds* missing
// publications (the class of bug root-caused on 2026-07-11: 91 T1
// price-list entries against 29 published-to-T1 products => 60+ SKUs
// silently invisible to wholesale contextualPricing).
//
// Every action (publish or skip) is written to the audit table
// `wholesale_publication_backfill_log` in Supabase.
//
// Cron schedule: `vercel.json` → 0 6 * * *  (6 AM UTC ≈ 2 AM ET).
// Auth: Bearer ${CRON_SECRET}. Manual runs: pass the same header, or
// hit `?preview=1&to=<name>@ycconsulting.biz` for a dry-check that
// still writes audit rows but only reports the delta.

import { NextRequest, NextResponse } from 'next/server';
import { reconcilePublications } from '@/lib/wholesale';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isPreview = url.searchParams.get('preview') === '1';
  const toOverride = url.searchParams.get('to');

  const auth = req.headers.get('authorization');
  if (!isPreview) {
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    if (!toOverride || !/@ycconsulting\.biz$/i.test(toOverride.trim())) {
      return NextResponse.json(
        { error: 'preview_requires_ycc_email', hint: 'add ?to=<name>@ycconsulting.biz' },
        { status: 400 }
      );
    }
  }

  const startedAt = new Date().toISOString();
  try {
    const summary = await reconcilePublications('cron');
    const totalPublished = summary.t1.published + summary.t2.published;
    const totalErrors = summary.t1.errors + summary.t2.errors;
    return NextResponse.json({
      ok: totalErrors === 0,
      version: '7.7.11',
      startedAt,
      finishedAt: new Date().toISOString(),
      summary,
      totalPublished,
      totalErrors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'reconcile failed';
    console.error('[wholesale-reconcile] fatal:', msg);
    return NextResponse.json(
      { ok: false, version: '7.7.11', startedAt, error: msg },
      { status: 500 }
    );
  }
}
