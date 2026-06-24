import { query } from '@/lib/db';
import type { MiraklFormData, TyreProduct } from '@/types';

/**
 * Builds Mirakl product and offer feed records from our internal product + form data,
 * using the operator's category/attribute mapping (mirakl_category_map / mirakl_attribute_map).
 *
 * "Product + offer" model: first the product (category + attributes) is imported, then an
 * offer (price/qty/state) referencing it by shop_sku/EAN.
 */

interface AttributeMapRow {
  attribute_code: string;
  source_field: string | null;
  fixed_value: string | null;
  value_map: Record<string, string> | null;
}

export async function getCategoryMapping(
  operator: string,
  sourceKind: string
): Promise<{ mirakl_category_code: string; mirakl_category_label: string | null } | null> {
  const rows = await query<{ mirakl_category_code: string; mirakl_category_label: string | null }>(
    `SELECT mirakl_category_code, mirakl_category_label FROM mirakl_category_map
     WHERE operator = ? AND source_kind IN (?, 'all')
     ORDER BY (source_kind = 'all') ASC LIMIT 1`,
    [operator, sourceKind]
  );
  return rows[0] ?? null;
}

async function getAttributeMap(operator: string, categoryCode: string): Promise<AttributeMapRow[]> {
  return query<AttributeMapRow>(
    `SELECT attribute_code, source_field, fixed_value, value_map
     FROM mirakl_attribute_map WHERE operator = ? AND mirakl_category_code = ?`,
    [operator, categoryCode]
  );
}

/** Read a source field from product or its extra_json.attrs. */
function readSourceField(product: TyreProduct | null | undefined, field: string): string {
  if (!product) return '';
  const direct = (product as unknown as Record<string, unknown>)[field];
  if (direct != null && typeof direct !== 'object') return String(direct);
  const attrs = product.extra_json?.attrs;
  if (attrs && field in attrs) return String(attrs[field]);
  return '';
}

function applyValueMap(value: string, valueMap: Record<string, string> | null): string {
  if (!valueMap) return value;
  return valueMap[value] ?? value;
}

/**
 * Build one product record (column code -> value). Precedence for each attribute:
 *   explicit formData.attributes > mapped source field / fixed value.
 */
export async function buildProductRecord(
  operator: string,
  product: TyreProduct | null,
  form: MiraklFormData
): Promise<Record<string, string>> {
  const map = await getAttributeMap(operator, form.categoryCode);

  const record: Record<string, string> = {
    'shop-sku': form.sku,
    category: form.categoryCode,
    'product-title': form.title,
    description: form.description,
  };
  if (form.ean) record['ean'] = form.ean;

  // 1) attributes derived from mapping (source field or fixed value)
  for (const row of map) {
    let value = '';
    if (row.source_field) value = applyValueMap(readSourceField(product, row.source_field), row.value_map);
    else if (row.fixed_value) value = row.fixed_value;
    if (value) record[row.attribute_code] = value;
  }

  // 2) explicit form attributes override the mapping
  for (const [code, val] of Object.entries(form.attributes ?? {})) {
    record[code] = Array.isArray(val) ? val.join('|') : String(val);
  }

  return record;
}

/** Build one OF24 offer object (JSON). `price` should already include margin/overrides. */
export function buildOfferRecord(form: MiraklFormData, price: number): Record<string, unknown> {
  return {
    shop_sku: form.sku,
    product_id: form.ean || undefined,
    product_id_type: form.ean ? 'EAN' : undefined,
    price,
    quantity: form.quantity,
    state_code: form.condition === 'USED' ? '6' : '11', // 11 = New, 6 = Used (Mirakl default state codes)
    logistic_class: form.logisticClass || undefined,
    leadtime_to_ship: form.leadtimeToShip ?? undefined,
    update_delete: 'update',
  };
}

/** Required-attribute completeness check; returns list of missing attribute codes. */
export function findMissingAttributes(
  required: { code: string; required: boolean }[],
  record: Record<string, string>
): string[] {
  return required.filter((a) => a.required && !record[a.code]).map((a) => a.code);
}
