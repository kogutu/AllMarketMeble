import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getJob, lastSync, setJob } from '@/lib/marketplaces/sync';

interface JobRow { marketplace: string; status: string; processed: number; total: number; message: string | null; started_at: string | null; updated_at: string }

/**
 * GET /api/marketplace/sync-status?slug=…  → single job + last sync.
 * GET /api/marketplace/sync-status?slug=all → all jobs (for the global progress widget).
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || 'empik';
  if (slug === 'all') {
    const jobs = await query<JobRow>('SELECT * FROM sync_jobs ORDER BY updated_at DESC');
    return NextResponse.json({ jobs });
  }
  const [job, last] = await Promise.all([getJob(slug), lastSync(slug)]);
  return NextResponse.json({ job, lastSync: last });
}

/**
 * DELETE /api/marketplace/sync-status?slug=… → reset sync job to idle.
 * DELETE /api/marketplace/sync-status?slug=all → reset ALL running jobs.
 * DELETE /api/marketplace/sync-status?slug=stuck → reset jobs running > 10 min.
 */
export async function DELETE(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || 'empik';

  if (slug === 'all') {
    await query(`UPDATE sync_jobs SET status='idle', message='Zresetowano ręcznie' WHERE status='running'`);
    return NextResponse.json({ reset: true, slug: 'all' });
  }

  if (slug === 'stuck') {
    // Auto-kill jobs running for more than 10 minutes without progress
    await query(
      `UPDATE sync_jobs SET status='idle', message='Auto-reset: brak aktywności > 10 min'
       WHERE status='running' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`
    );
    return NextResponse.json({ reset: true, slug: 'stuck' });
  }

  await setJob(slug, { status: 'idle', message: 'Zresetowano ręcznie' });
  return NextResponse.json({ reset: true, slug });
}
