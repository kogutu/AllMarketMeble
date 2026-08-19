'use client';

import { useEffect, useRef, useState } from 'react';
import { getMarketplace } from '@/lib/marketplaces/catalog';

interface Job {
  marketplace: string; status: string; processed: number; total: number;
  message: string | null; started_at: string | null; updated_at: string;
}

const STUCK_MINUTES = 10;

/** Floating widget showing running sync jobs + reset button. Auto-kills stuck syncs after 10 min. */
export default function GlobalSyncProgress() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [resetting, setResetting] = useState(false);
  const autoKilledRef = useRef(false);

  const resetAll = async () => {
    setResetting(true);
    await fetch('/api/marketplace/sync-status?slug=all', { method: 'DELETE' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const d = await fetch('/api/marketplace/sync-status?slug=all').then((r) => r.json()).catch(() => null);
    if (d?.jobs) setJobs(d.jobs);
    setResetting(false);
  };

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const d = await fetch('/api/marketplace/sync-status?slug=all').then((r) => r.json()).catch(() => null);
      if (!alive || !d?.jobs) return;
      setJobs(d.jobs);

      // Auto-kill syncs stuck for > STUCK_MINUTES minutes (server-side check)
      if (!autoKilledRef.current) {
        const hasStuck = (d.jobs as Job[]).some((j) => {
          if (j.status !== 'running') return false;
          const updated = j.updated_at ? new Date(j.updated_at).getTime() : 0;
          return Date.now() - updated > STUCK_MINUTES * 60 * 1000;
        });
        if (hasStuck) {
          autoKilledRef.current = true;
          fetch('/api/marketplace/sync-status?slug=stuck', { method: 'DELETE' }).catch(() => {});
        }
      }
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
        const updatedMs = j.updated_at ? Date.now() - new Date(j.updated_at).getTime() : 0;
        const isStuck = updatedMs > STUCK_MINUTES * 60 * 1000;
        return (
          <div key={j.marketplace} className={`bg-white rounded-lg shadow-lg border p-3 ${isStuck ? 'border-red-300' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium text-gray-800 flex items-center gap-2">
                <span className={`w-3 h-3 border-2 rounded-full inline-block ${isStuck ? 'border-red-400 border-t-red-600 animate-spin' : 'border-indigo-300 border-t-indigo-600 animate-spin'}`} />
                {name}
                {isStuck && <span className="text-xs text-red-500 font-normal">(zawieszona)</span>}
              </span>
              <span className="text-gray-500 tabular-nums text-xs">
                {j.processed.toLocaleString('pl')} / {(j.total || 0).toLocaleString('pl')}
              </span>
            </div>
            <div className="h-1.5 w-full bg-gray-200 rounded overflow-hidden">
              <div className={`h-full transition-all ${isStuck ? 'bg-red-400' : 'bg-indigo-600'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}

      {/* Reset button */}
      <div className="flex justify-end">
        <button
          onClick={resetAll}
          disabled={resetting}
          className="text-xs px-3 py-1.5 rounded-md bg-white border border-gray-300 shadow text-gray-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {resetting ? (
            <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin inline-block" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Resetuj sync
        </button>
      </div>
    </div>
  );
}
