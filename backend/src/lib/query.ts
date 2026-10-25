/** Normalises a Fastify querystring object for zod: repeated params → arrays, numbers, JSON. */
export function normQuery(raw: Record<string, unknown>, spec: { arrays?: string[]; ints?: string[]; json?: string[]; bools?: string[] }) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === "") continue;
    if (spec.arrays?.includes(k)) out[k] = Array.isArray(v) ? v : [v];
    else if (spec.ints?.includes(k)) out[k] = Number(Array.isArray(v) ? v[0] : v);
    else if (spec.bools?.includes(k)) out[k] = (Array.isArray(v) ? v[0] : v) === "true";
    else if (spec.json?.includes(k)) {
      try { out[k] = JSON.parse(String(Array.isArray(v) ? v[0] : v)); } catch { out[k] = "__invalid__"; }
    } else out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export function page(raw: Record<string, unknown>, max = 100) {
  const p = Math.max(1, Math.floor(Number(raw.page ?? 1)) || 1);
  const s = Math.min(max, Math.max(1, Math.floor(Number(raw.pageSize ?? 20)) || 20));
  return { page: p, pageSize: s, offset: (p - 1) * s };
}

export const iso = (v: Date | string | null | undefined) => (v == null ? null : new Date(v).toISOString());

/** Postgres `ILIKE` pattern with wildcards escaped. */
export const likeTerm = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
