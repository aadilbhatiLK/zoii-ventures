/**
 * CSV builder with spreadsheet formula-injection protection: cells beginning with
 * = + - @ (or tab/CR) are prefixed with an apostrophe so Excel/Sheets treat them as text.
 */
export function csvCell(value: string): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(header: string[], rows: string[][], banner?: string): string {
  const lines: string[] = [];
  if (banner) lines.push(csvCell(banner));
  lines.push(header.map(csvCell).join(","));
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
