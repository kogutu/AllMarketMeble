'use client';

import { useEffect, useState } from 'react';
import { getMarketplace } from '@/lib/marketplaces/catalog';

interface Job { marketplace: string; status: string; processed: number; total: number; message: string | null; }

/** Floating widget (visible on every page) showing any running marketplace sync jobs. */
export default function GlobalSyncProgress() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const d = await fetch('/api/marketplace/sync-status?slug=all').then((r) => r.json()).catch(() => null);
      if (alive && d?.jobs) setJobs(d.jobs);
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const running = jobs.filter((j) => j.status === 'running');
  if (running.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {running.map((j) => {
        const pct = j.total ? Math.min(100, Math.round((j.processed / j.total) * 100)) : 0;
        const name = getMarketplace(j.marketplace)?.name ?? j.marketplace;
        return (
          <div key={j.marketplace} className="bg-white rounded-lg shadow-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium text-gray-800 flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin inline-block" />
                Synchronizacja: {name}
              </span>
              <span className="text-gray-500 tabular-nums text-xs">{j.processed.toLocaleString('pl')} / {(j.total || 0).toLocaleString('pl')}</span>
            </div>
            <div className="h-1.5 w-full bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
