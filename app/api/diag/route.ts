import { NextResponse } from 'next/server';

/** GET /api/diag — sprawdza połączenie z zewnętrznymi API */
export async function GET() {
  const checks = [
    { name: 'Allegro API', url: 'https://api.allegro.pl/sale/categories?parent.id=954b95b6-43cf-4104-a0bc-3c3eb8c14a62&limit=1' },
    { name: 'Empik (Mirakl)', url: 'https://marketplace.empik.com/api/hierarchies?max=1' },
    { name: 'BRW (Mirakl)', url: 'https://mirakl.blackredwhite.com/api/hierarchies?max=1' },
  ];

  const results = await Promise.all(
    checks.map(async ({ name, url }) => {
      const start = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        return { name, ok: true, status: res.status, ms: Date.now() - start };
      } catch (e: unknown) {
        const err = e as { cause?: { code?: string }; name?: string; message?: string };
        return {
          name, ok: false, ms: Date.now() - start,
          error: err?.cause?.code || err?.name || String(err?.message).slice(0, 80),
        };
      }
    })
  );

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ allOk, region: process.env.VERCEL_REGION || 'unknown', results });
}
