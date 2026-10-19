/**
 * Pobiera całe drzewo kategorii Kaufland (storefront PL) i zapisuje snapshot do
 * mirakl_data/kaufland/categories.json. Uruchom okresowo, gdy drzewo kategorii się zmieni:
 *   node scripts/fetch-kaufland-categories.js
 *
 * Snapshot pozwala getAllCategories() odpowiadać natychmiast (bez ~60 żądań API na zimnym
 * cache), co przyspiesza dopasowanie kategorii AI — szczególnie na Vercel (serverless cold start).
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
const axios = require('axios');
const crypto = require('crypto');

const clean = (v) => (v || '').trim().replace(/^['"]+/, '').replace(/['";]+$/, '').trim();
const BASE = clean(process.env.KAUFLAND_API) || 'https://sellerapi.kaufland.com/v2';
const CK = clean(process.env.KAUFLAND_API_CLIENT_KEY);
const SEC = clean(process.env.KAUFLAND_API_SECRET_KEY);
const SF = clean(process.env.KAUFLAND_STOREFRONT) || 'pl';
const sign = (m, u, b, ts) => crypto.createHmac('sha256', SEC).update(`${m}\n${u}\n${b}\n${ts}`, 'utf8').digest('hex');

async function page(offset) {
  const ts = Math.floor(Date.now() / 1000);
  const qs = '?' + new URLSearchParams({ storefront: SF, limit: 100, offset }).toString();
  const url = `${BASE}/categories${qs}`;
  const r = await axios.get(url, {
    headers: { 'Shop-Client-Key': CK, 'Shop-Timestamp': String(ts), 'Shop-Signature': sign('GET', url, '', ts), Accept: 'application/json', 'User-Agent': 'kaufland-cat-snapshot/1.0' },
    timeout: 30000,
  });
  return r.data;
}

(async () => {
  if (!CK || !SEC) { console.error('Brak KAUFLAND_API_CLIENT_KEY / KAUFLAND_API_SECRET_KEY w .env.local'); process.exit(1); }
  const first = await page(0);
  const total = Number(first.pagination?.total ?? (first.data || []).length);
  let all = [...(first.data || [])];
  const offs = [];
  for (let o = 100; o < total; o += 100) offs.push(o);
  for (let i = 0; i < offs.length; i += 8) {
    const ps = await Promise.all(offs.slice(i, i + 8).map((o) => page(o).then((d) => d.data || []).catch(() => [])));
    ps.forEach((p) => all.push(...p));
  }
  // Zapisz tylko potrzebne pola (mniejszy plik).
  const slim = all.map((c) => ({
    id_category: c.id_category, name: c.name, title_singular: c.title_singular,
    title_plural: c.title_plural, level: c.level, is_leaf: c.is_leaf,
    id_parent_category: c.id_parent_category, vat: c.vat,
  }));
  const outDir = path.join(process.cwd(), 'mirakl_data', 'kaufland');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'categories.json');
  fs.writeFileSync(outFile, JSON.stringify(slim), 'utf8');
  console.log(`Zapisano ${slim.length} kategorii (${all.filter((c) => c.is_leaf).length} liści) → ${outFile}`);
})().catch((e) => { console.error('Błąd:', e.response?.status, JSON.stringify(e.response?.data) || e.message); process.exit(1); });
