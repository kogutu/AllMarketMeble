import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DM = path.join(process.cwd(), 'data_market');

function loadJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T; } catch { return null; }
}

const reqCache = new Map<string, Record<string, string[]>>();
const daneCache = new Map<string, Record<string, string[]>>();

function getReq(operator: string): Record<string, string[]> {
  if (reqCache.has(operator)) return reqCache.get(operator)!;
  const files: Record<string, string> = { brw: path.join(DM, 'brw', 'brw_req.json') };
  const data = loadJson<Record<string, string[]>>(files[operator] ?? '') ?? {};
  reqCache.set(operator, data);
  return data;
}

function getDane(operator: string): Record<string, string[]> {
  if (daneCache.has(operator)) return daneCache.get(operator) as Record<string, string[]>;
  const files: Record<string, string> = { brw: path.join(DM, 'brw', 'dane_brw.json') };
  const raw = loadJson<Record<string, unknown[]>>(files[operator] ?? '') ?? {};
  const data: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) data[k] = (v as unknown[]).map(String);
  daneCache.set(operator, data);
  return data;
}

/**
 * GET /api/mirakl/required-attrs?operator=brw&categoryPath=Meble/Stoły i krzesła/...
 * Returns required attributes for a BRW category path, with values from dane_brw.json.
 * These attributes are NOT returned by the Mirakl API but are still validated on import.
 */
export async function GET(req: NextRequest) {
  const operator = req.nextUrl.searchParams.get('operator') || 'brw';
  const categoryPath = req.nextUrl.searchParams.get('categoryPath') || '';

  const reqMap = getReq(operator);
  const dane = getDane(operator);

  // Offer-level fields handled elsewhere — never show as category attributes
  const SKIP = new Set(['sku', 'product-id', 'product-id-type', 'price', 'state',
    'product sku', 'pimcore-model-attribute-name[pl]', 'pimcore-model-attribute-ean',
    'pimcore-model-attribute-description[pl]', 'pimcore-model-attribute-miraklCategory',
    'pimcore-model-attribute-producer']);

  // Find required attrs for the given category path (exact or closest prefix match)
  const allCodes: string[] = reqMap[categoryPath]
    ?? Object.entries(reqMap).find(([k]) => categoryPath.startsWith(k) || k.startsWith(categoryPath))?.[1]
    ?? [];
  const codes = allCodes.filter((c) => !SKIP.has(c) && !c.startsWith('pimcore-model-attribute-photos'));

  const attributes = codes.map((code) => {
    const rawVals = dane[code];
    const values = Array.isArray(rawVals)
      ? rawVals.map((v) => ({ code: String(v), label: String(v) }))
      : [];
    return {
      code,
      label: code.replace('pimcore-classificationstore-key-', '').replace(/_/g, ' '),
      type: values.length > 0 ? 'LIST' : 'TEXT',
      required: true,
      multiple: false,
      values,
    };
  });

  return NextResponse.json({ attributes });
}
