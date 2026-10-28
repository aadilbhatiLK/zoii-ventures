import PDFDocument from "pdfkit";
import type { Quotation } from "@/lib/api/modules/sales";
import { formatAmount } from "@/lib/money";
import { STATE_CODES } from "@/lib/validation/gstin";
import { amountInWords } from "../../lib/words";

export interface Party { legalName: string; gstin: string | null; address: string; stateCode: string | null; email?: string | null; phone?: string | null }
export interface DocMeta { title: string; number: string; date: string; extra: [string, string][] }
export interface PdfLine { description: string; hsnSac: string; quantity: string; unitPrice: string; discountPct: string; taxable: string; taxRate: string; total: string }
export interface PdfTotals { taxableTotal: string; cgst: string; sgst: string; igst: string; grandTotal: string; supplyType: "intra" | "inter"; discountTotal?: string; subtotal?: string }

const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const stateLabel = (c: string | null) => (c ? `${STATE_CODES[c] ?? "—"} (${c})` : "—");

/** Renders a GST-style commercial document (quotation / tax invoice / credit note). */
export function renderCommercialPdf(o: {
  supplier: Party; buyer: Party; meta: DocMeta; lines: PdfLine[]; totals: PdfTotals; notes?: string | null; terms?: string | null;
  bank?: { name: string; account: string; ifsc: string; branch?: string } | null; footer?: string; watermark?: string | null;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `${o.meta.title} ${o.meta.number}`, Author: o.supplier.legalName } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const W = doc.page.width - 80;
    const ink = "#1d1b2e", muted = "#5c5a6e", rule = "#d9d7e3", accent = "#5748d4";

    if (o.watermark) {
      doc.save().rotate(-30, { origin: [300, 420] }).fontSize(70).fillColor("#eeeeee").text(o.watermark, 60, 380, { width: 500, align: "center" }).restore();
    }
    doc.fillColor(accent).fontSize(18).font("Helvetica-Bold").text(o.supplier.legalName, 40, 40);
    doc.fillColor(muted).fontSize(9).font("Helvetica").text(o.supplier.address, { width: W * 0.6 });
    if (o.supplier.gstin) doc.text(`GSTIN: ${o.supplier.gstin}   State: ${stateLabel(o.supplier.stateCode)}`);
    if (o.supplier.email || o.supplier.phone) doc.text([o.supplier.email, o.supplier.phone].filter(Boolean).join("  ·  "));
    doc.fillColor(ink).fontSize(16).font("Helvetica-Bold").text(o.meta.title.toUpperCase(), 40, 40, { width: W, align: "right" });
    doc.fontSize(9).font("Helvetica").fillColor(muted);
    doc.text(`No. ${o.meta.number}`, { width: W, align: "right" });
    doc.text(`Date: ${fmtDate(o.meta.date)}`, { width: W, align: "right" });
    for (const [k, v] of o.meta.extra) doc.text(`${k}: ${v}`, { width: W, align: "right" });

    let y = Math.max(doc.y, 120) + 12;
    doc.moveTo(40, y).lineTo(40 + W, y).strokeColor(rule).stroke();
    y += 10;
    doc.fillColor(muted).fontSize(8).text("BILL TO", 40, y);
    doc.fillColor(ink).fontSize(11).font("Helvetica-Bold").text(o.buyer.legalName, 40, y + 11, { width: W * 0.6 });
    doc.font("Helvetica").fontSize(9).fillColor(muted).text(o.buyer.address || "—", { width: W * 0.6 });
    doc.text(`GSTIN: ${o.buyer.gstin ?? "Unregistered"}`);
    doc.text(`Place of supply: ${stateLabel(o.buyer.stateCode)}`);
    y = doc.y + 14;

    const cols = [
      { h: "#", w: 18, a: "left" as const }, { h: "Description", w: 128, a: "left" as const }, { h: "HSN/SAC", w: 46, a: "left" as const },
      { h: "Qty", w: 36, a: "right" as const }, { h: "Rate", w: 64, a: "right" as const }, { h: "Disc %", w: 36, a: "right" as const },
      { h: "Taxable", w: 70, a: "right" as const }, { h: "GST %", w: 32, a: "right" as const }, { h: "Amount", w: W - 430, a: "right" as const },
    ];
    const row = (vals: string[], bold = false, fill?: string) => {
      const heights = vals.map((v, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).heightOfString(v, { width: cols[i].w - 6 }));
      const h = Math.max(...heights) + 8;
      if (y + h > doc.page.height - 120) { doc.addPage(); y = 40; }
      if (fill) doc.rect(40, y, W, h).fill(fill);
      let x = 40;
      vals.forEach((v, i) => {
        doc.fillColor(ink).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).text(v, x + 3, y + 4, { width: cols[i].w - 6, align: cols[i].a });
        x += cols[i].w;
      });
      y += h;
      doc.moveTo(40, y).lineTo(40 + W, y).strokeColor(rule).stroke();
    };
    row(cols.map((c) => c.h), true, "#f1f0f7");
    o.lines.forEach((l, i) => row([String(i + 1), l.description, l.hsnSac, l.quantity.replace(/\.?0+$/, ""), formatAmount(l.unitPrice), l.discountPct.replace(/\.00$/, ""), formatAmount(l.taxable), l.taxRate.replace(/\.00$/, ""), formatAmount(l.total)]));

    y += 8;
    const tx = 40 + W - 220;
    const line = (k: string, v: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor(bold ? ink : muted).text(k, tx, y, { width: 120 });
      doc.fillColor(ink).text(v, tx + 120, y, { width: 100, align: "right" });
      y += bold ? 18 : 14;
    };
    if (o.totals.discountTotal && o.totals.discountTotal !== "0.00") { line("Gross", formatAmount(o.totals.subtotal!)); line("Discount", `-${formatAmount(o.totals.discountTotal)}`); }
    line("Taxable value", formatAmount(o.totals.taxableTotal));
    if (o.totals.supplyType === "intra") { line("CGST", formatAmount(o.totals.cgst)); line("SGST", formatAmount(o.totals.sgst)); }
    else line("IGST", formatAmount(o.totals.igst));
    doc.moveTo(tx, y).lineTo(40 + W, y).strokeColor(rule).stroke(); y += 6;
    line("Total (INR)", formatAmount(o.totals.grandTotal), true);
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(muted).text(amountInWords(o.totals.grandTotal), 40, y, { width: W });
    y = doc.y + 12;

    const block = (title: string, body: string) => {
      if (y > doc.page.height - 140) { doc.addPage(); y = 40; }
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ink).text(title, 40, y);
      doc.font("Helvetica").fontSize(8.5).fillColor(muted).text(body, { width: W });
      y = doc.y + 10;
    };
    if (o.bank) block("Bank details", `${o.bank.name}\nA/c ${o.bank.account} · IFSC ${o.bank.ifsc}${o.bank.branch ? ` · ${o.bank.branch}` : ""}`);
    if (o.notes) block("Notes", o.notes);
    if (o.terms) block("Terms & conditions", o.terms);
    doc.font("Helvetica").fontSize(7.5).fillColor(muted).text(o.footer ?? "This is a computer-generated document.", 40, doc.page.height - 60, { width: W, align: "center" });
    doc.end();
  });
}

export function quotationPdf(q: Quotation, supplier: Party, buyer: Party, bank: Parameters<typeof renderCommercialPdf>[0]["bank"]) {
  return renderCommercialPdf({
    supplier, buyer, bank,
    meta: { title: "Quotation", number: q.displayNumber, date: q.quoteDate, extra: [["Valid until", fmtDate(q.validUntil)]] },
    lines: q.lines, totals: { ...q, supplyType: q.supplyType },
    notes: q.notes, terms: q.terms,
    watermark: q.status === "draft" || q.status === "pending_approval" ? "DRAFT" : q.status === "superseded" ? "SUPERSEDED" : null,
    footer: "Prices in INR. Taxes as applicable on the date of invoice. This is a computer-generated quotation.",
  });
}
