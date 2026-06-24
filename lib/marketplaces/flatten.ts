/** Flatten a marketplace offer into a scalar map (dot keys; arrays joined) for grid columns/export. */
export function flatten(
  obj: unknown,
  prefix = '',
  out: Record<string, string | number | boolean> = {},
  depth = 0
): Record<string, string | number | boolean> {
  if (obj == null || depth > 9) return out;
  if (Array.isArray(obj)) {
    if (obj.every((v) => v == null || typeof v !== 'object')) {
      if (obj.length) out[prefix] = obj.filter((v) => v != null).join('; ');
    } else {
      obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, depth + 1));
    }
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
    return out;
  }
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    if (prefix) out[prefix] = obj;
  }
  return out;
}
