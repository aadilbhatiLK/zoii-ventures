/**
 * Exact decimal money arithmetic on integer paise (bigint). Money crosses every boundary
 * as a decimal string ("1234.50"); floats are never used for amounts.
 * Rounding is half-up (away from zero), applied once per computed value.
 */
export type Paise = bigint;

const MONEY_RE = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/;

export function toPaise(v: string | number | bigint): Paise {
  if (typeof v === "bigint") return v * 100n;
  const s = typeof v === "number" ? v.toFixed(2) : v.trim();
  const m = MONEY_RE.exec(s);
  if (!m) throw new Error(`Not a money amount: ${String(v)}`);
  const p = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -p : p;
}

export function fromPaise(p: Paise): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

export const sum = (xs: Paise[]) => xs.reduce((a, b) => a + b, 0n);
export const money = (v: string | number) => fromPaise(toPaise(v));

/** Divide with half-up rounding (away from zero). */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("division by zero");
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/**
 * A decimal with up to `scale` places as a scaled bigint, e.g. ("18.5", 2) → 1850n.
 * Used for tax rates (2 dp) and quantities (3 dp).
 */
export function toScaled(v: string | number, scale: number): bigint {
  const s = typeof v === "number" ? v.toFixed(scale) : v.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[3] ?? "").length > scale) throw new Error(`Invalid decimal ${String(v)} (max ${scale} dp)`);
  const x = BigInt(m[2]) * 10n ** BigInt(scale) + BigInt((m[3] ?? "").padEnd(scale, "0") || "0");
  return m[1] ? -x : x;
}

/** amount × (pct / 100), pct with 2 dp, half-up. */
export function percentOf(amount: Paise, pct: string | number): Paise {
  return divRound(amount * toScaled(pct, 2), 10_000n);
}

/** unit × qty (qty with up to 3 dp), half-up. */
export function times(unit: Paise, qty: string | number): Paise {
  return divRound(unit * toScaled(qty, 3), 1000n);
}

export function formatAmount(v: string): string {
  const p = toPaise(v);
  const s = fromPaise(p < 0n ? -p : p);
  const [int, dec] = s.split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${p < 0n ? "-" : ""}${rest ? `${rest},` : ""}${last3}.${dec}`;
}
