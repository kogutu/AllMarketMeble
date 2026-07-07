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

/** DELETE /api/marketplace/sync-status?slug=… → reset stuck sync job to idle */
export async function DELETE(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || 'empik';
  await setJob(slug, { status: 'idle', message: 'Zresetowano ręcznie' });
  return NextResponse.json({ reset: true, slug });
}
