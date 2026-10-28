/**
 * GST computation for Indian supplies, shared by the backend (authoritative) and the UI
 * (preview only). Rules:
 *  - Line taxable value = qty × unit price − line discount (discount % on gross).
 *  - Tax per line at the rate in force on the document date (versioned tax rules).
 *  - Intra-state supply (supplier state = place of supply): CGST + SGST, each rate/2,
 *    each rounded separately. Inter-state: IGST at the full rate.
 *  - Unregistered recipients still get place of supply from their billing state.
 * This is a calculation aid, not tax advice; rates and HSN/SAC mapping are maintained
 * by finance in Tax rules and should be confirmed with the company's CA.
 */
import { divRound, fromPaise, percentOf, sum, times, toPaise, toScaled } from "@/lib/money";

export interface TaxLineInput {
  description: string;
  hsnSac: string;
  quantity: string; // up to 3 dp
  unitPrice: string; // money
  discountPct: string; // 0–100, 2 dp
  taxRate: string; // e.g. "18.00"
}

export interface TaxLineResult extends TaxLineInput {
  gross: string;
  discount: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

export interface TaxTotals {
  supplyType: "intra" | "inter";
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  cgst: string;
  sgst: string;
  igst: string;
  taxTotal: string;
  grandTotal: string;
  lines: TaxLineResult[];
}

export function supplyTypeFor(supplierState: string, placeOfSupply: string): "intra" | "inter" {
  return supplierState === placeOfSupply ? "intra" : "inter";
}

export function computeTaxLine(l: TaxLineInput, supplyType: "intra" | "inter"): TaxLineResult {
  const disc = toScaled(l.discountPct || "0", 2);
  if (disc < 0n || disc > 10_000n) throw new Error("Discount must be between 0 and 100%.");
  const rate = toScaled(l.taxRate, 2);
  if (rate < 0n || rate > 10_000n) throw new Error("Tax rate must be between 0 and 100%.");
  const gross = times(toPaise(l.unitPrice), l.quantity);
  const discount = percentOf(gross, l.discountPct || "0");
  const taxable = gross - discount;
  let cgst = 0n, sgst = 0n, igst = 0n;
  if (supplyType === "intra") {
    cgst = divRound(taxable * rate, 20_000n);
    sgst = cgst;
  } else {
    igst = divRound(taxable * rate, 10_000n);
  }
  return {
    ...l,
    gross: fromPaise(gross),
    discount: fromPaise(discount),
    taxable: fromPaise(taxable),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    total: fromPaise(taxable + cgst + sgst + igst),
  };
}

export function computeTax(lines: TaxLineInput[], supplyType: "intra" | "inter"): TaxTotals {
  const res = lines.map((l) => computeTaxLine(l, supplyType));
  const s = (k: keyof TaxLineResult) => sum(res.map((r) => toPaise(r[k] as string)));
  const cgst = s("cgst"), sgst = s("sgst"), igst = s("igst"), taxable = s("taxable");
  return {
    supplyType,
    subtotal: fromPaise(s("gross")),
    discountTotal: fromPaise(s("discount")),
    taxableTotal: fromPaise(taxable),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    taxTotal: fromPaise(cgst + sgst + igst),
    grandTotal: fromPaise(taxable + cgst + sgst + igst),
    lines: res,
  };
}
