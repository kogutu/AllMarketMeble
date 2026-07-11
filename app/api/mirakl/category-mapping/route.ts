import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const FILES: Record<string, string> = {
  empik: path.join(process.cwd(), 'data_market', 'empik', 'empik_mapping_category.json'),
  brw:   path.join(process.cwd(), 'data_market', 'brw',   'brwmapping_category.json'),
};

const cache = new Map<string, Record<string, string>>();

function load(operator: string): Record<string, string> {
  const cached = cache.get(operator);
  if (cached) return cached;
  const file = FILES[operator];
  if (!file) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    cache.set(operator, data);
    return data;
  } catch {
    return {};
  }
}

/** GET /api/mirakl/category-mapping?operator=empik&categoryId=151 */
export async function GET(req: NextRequest) {
  const operator = req.nextUrl.searchParams.get('operator') || '';
  const categoryId = req.nextUrl.searchParams.get('categoryId') || '';
  const mapping = load(operator);
  if (categoryId) {
    return NextResponse.json({ value: mapping[categoryId] ?? null });
  }
  return NextResponse.json({ mapping });
}
