'use client';

/**
 * Blocking overlay for CRUD offer forms. While data is loading / AI is working, it covers the
 * whole form (apla + blur), captures pointer events and shows a spinner with a label so the user
 * cannot edit mid-operation. Parent must be `position: relative`.
 */
export default function CrudOverlay({ show, label, accent = 'indigo' }: {
  show: boolean;
  label: string;
  accent?: 'indigo' | 'red' | 'green' | 'allegro';
}) {
  if (!show) return null;
  const ring = {
    indigo: 'border-indigo-200 border-t-indigo-600',
    red: 'border-red-200 border-t-red-600',
    green: 'border-green-200 border-t-green-600',
    allegro: 'border-amber-200 border-t-amber-600',
  }[accent];

  return (
    <>
      {/* Apla + blur na całym formularzu (blokuje interakcję). */}
      <div className="absolute inset-0 z-30 rounded-xl bg-white/70 backdrop-blur-[2px] cursor-wait"
        onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
        aria-busy="true" />
      {/* Spinner jako SIOSTRA apli (poza elementem z backdrop-blur, który tworzy containing block dla
          fixed) — przypięty do okna, zawsze widoczny niezależnie od przewinięcia formularza. */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-white shadow-lg border border-gray-100 pointer-events-none">
        <span className={`w-8 h-8 rounded-full border-4 ${ring} animate-spin`} />
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
    </>
  );
}
