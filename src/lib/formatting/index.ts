import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  parseISO,
} from "date-fns";

const inrFull = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Money travels as a decimal string ("125000.00"); formatting is display-only. */
export function formatINR(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  return inrFull.format(n);
}

/** Compact Indian notation: ₹4.2L, ₹1.3Cr, ₹85K. */
export function formatINRCompact(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (v: number) => v.toFixed(v >= 100 ? 0 : 1).replace(/\.0$/, "");
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits).replace(/\.0$/, "")}%`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

export function toDate(value: string | Date): Date {
  return typeof value === "string" ? parseISO(value) : value;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return format(toDate(value), "d MMM yyyy");
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return format(toDate(value), "d MMM yyyy, h:mm a");
}

export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "—";
  const d = toDate(value);
  const days = differenceInCalendarDays(d, now);
  if (isToday(d)) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

export type DueState = "none" | "overdue" | "today" | "upcoming";

export function dueState(value: string | null | undefined, now: Date = new Date()): DueState {
  if (!value) return "none";
  const d = toDate(value);
  const days = differenceInCalendarDays(d, now);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return "upcoming";
}
