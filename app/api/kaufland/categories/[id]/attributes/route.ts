import { NextRequest, NextResponse } from 'next/server';
import { KauflandClient } from '@/lib/marketplaces/kaufland/client';

/**
 * GET /api/kaufland/categories/{id}/attributes
 * Kaufland exposes no per-category required-attribute schema (the catalog is EAN-matched), so this
 * returns the offer-level options the form needs: shipping groups, warehouses and the category VAT.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [shippingGroups, warehouses, category] = await Promise.all([
      KauflandClient.getShippingGroups(),
      KauflandClient.getWarehouses(),
      KauflandClient.getCategory(Number(params.id)).catch(() => null),
    ]);
    return NextResponse.json({
      attributes: [],            // Kaufland has no per-category required attributes
      shippingGroups: shippingGroups.map((g) => ({ id: g.id_shipping_group, name: g.name, isDefault: !!g.is_default })),
      warehouses: warehouses.map((w) => ({ id: w.id_warehouse, name: w.name, isDefault: !!w.is_default })),
      category: category ? { id: category.id_category, label: category.title_singular || category.name, vat: category.vat } : null,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch attributes', details: String(error) }, { status: 500 });
  }
}
