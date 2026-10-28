import type { Client } from "@/lib/api/contracts";
import { STATE_CODES } from "@/lib/validation/gstin";

/** Place-of-supply state code for a client: GSTIN prefix, else the billing-address state. */
export function stateCodeOf(c: Pick<Client, "gstin" | "billingAddress">): string | null {
  if (c.gstin) return c.gstin.slice(0, 2);
  const n = c.billingAddress.state.trim().toLowerCase();
  return Object.entries(STATE_CODES).find(([, v]) => v.toLowerCase() === n)?.[0] ?? null;
}
