import { z } from "zod";

export const Money = z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter an amount like 1500 or 1500.50");
export const Qty = z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a quantity like 1 or 2.5").refine((v) => Number(v) > 0, "Quantity must be more than 0");
export const Pct = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage like 10 or 12.5").refine((v) => Number(v) <= 100, "At most 100%");
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Invalid date");
export const HsnSac = z.string().trim().regex(/^[0-9]{4,8}$/, "HSN/SAC is 4–8 digits");
export const Id = z.string().uuid("Invalid id");
export const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export const BILLING_CYCLES = { one_time: "One-time", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" } as const;
export type BillingCycle = keyof typeof BILLING_CYCLES;

/** Optional date from a form: an empty input means "not set", not an invalid date. */
export const OptDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), DateOnly.optional());
export const NullableDate = z.preprocess((v) => (v === "" ? null : v), DateOnly.nullable().optional());
