import { describe, expect, it } from "vitest";
import { validateGstin, gstinChecksumChar } from "@/lib/validation/gstin";
import { ClientInputSchema, LeadInputSchema, MoneySchema } from "@/lib/api/contracts";
import { csvCell, toCsv } from "@/lib/csv";
import { safeNextPath } from "@/features/auth/safe-next";
import { dueState, formatINRCompact } from "@/lib/formatting";

describe("GSTIN", () => {
  it("accepts real registered GSTINs and derives state + PAN", () => {
    expect(validateGstin("08AAOCP3812A1ZN")).toEqual({
      valid: true,
      stateCode: "08",
      stateName: "Rajasthan",
      pan: "AAOCP3812A",
    });
    expect(validateGstin("08dafpb0613a1zn")).toMatchObject({ valid: true, stateName: "Rajasthan" });
  });
  it("rejects a wrong checksum, bad state code and bad shape", () => {
    expect(validateGstin("08AAOCP3812A1ZM").valid).toBe(false);
    expect(validateGstin("99AAOCP3812A1Z" + gstinChecksumChar("99AAOCP3812A1Z")).valid).toBe(false);
    expect(validateGstin("08AAOCP3812A").valid).toBe(false);
  });
});

describe("contracts", () => {
  it("money is a decimal string, never a float or negative", () => {
    expect(MoneySchema.safeParse("125000").success).toBe(true);
    expect(MoneySchema.safeParse("125000.50").success).toBe(true);
    expect(MoneySchema.safeParse("125000.505").success).toBe(false);
    expect(MoneySchema.safeParse("-5").success).toBe(false);
    expect(MoneySchema.safeParse("1e5").success).toBe(false);
  });
  const lead = {
    name: "Asha Jain",
    phone: "+91 98290 12345",
    productInterest: ["pos"],
    source: "website",
    priority: "high",
    estimatedValue: "45000",
    ownerId: "u1",
  } as const;
  it("lead input requires phone, interest and owner", () => {
    expect(LeadInputSchema.safeParse(lead).success).toBe(true);
    expect(LeadInputSchema.safeParse({ ...lead, productInterest: [] }).success).toBe(false);
    expect(LeadInputSchema.safeParse({ ...lead, phone: "abc" }).success).toBe(false);
    expect(LeadInputSchema.safeParse({ ...lead, email: "not-an-email" }).success).toBe(false);
  });
  it("lead input normalises blanks and lower-cases email", () => {
    const r = LeadInputSchema.parse({ ...lead, company: "  ", email: "Asha@Example.COM" });
    expect(r.company).toBeUndefined();
    expect(r.email).toBe("asha@example.com");
  });
  it("client input validates GSTIN checksum and PIN code", () => {
    const base = {
      name: "Acme",
      legalName: "Acme Pvt Ltd",
      industry: "Retail",
      category: "smb",
      status: "active",
      accountManagerId: "u_am",
      billingAddress: {
        line1: "12 MG Road",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302001",
      },
      productLines: [],
      primaryContact: { name: "R K", phone: "9829012345" },
    } as const;
    expect(ClientInputSchema.safeParse(base).success).toBe(true);
    expect(ClientInputSchema.safeParse({ ...base, gstin: "08AAOCP3812A1ZN" }).success).toBe(true);
    expect(ClientInputSchema.safeParse({ ...base, gstin: "08AAOCP3812A1ZX" }).success).toBe(false);
    expect(
      ClientInputSchema.safeParse({
        ...base,
        billingAddress: { ...base.billingAddress, pincode: "012345" },
      }).success,
    ).toBe(false);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas and quotes separators", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("Jain, Sons")).toBe('"Jain, Sons"');
    expect(toCsv(["a"], [["1"]], "DEMO")).toBe("﻿DEMO\r\na\r\n1");
  });
});

describe("post-login redirect", () => {
  it("only allows same-origin relative paths", () => {
    expect(safeNextPath("/leads/lead_001")).toBe("/leads/lead_001");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});

describe("formatting", () => {
  it("uses Indian compact units", () => {
    expect(formatINRCompact("4500000")).toBe("₹45L");
    expect(formatINRCompact(12_500_000)).toBe("₹1.3Cr");
    expect(formatINRCompact("85000.00")).toBe("₹85K");
    expect(formatINRCompact(null)).toBe("—");
  });
  it("classifies follow-up due dates", () => {
    const now = new Date("2026-10-25T10:00:00");
    expect(dueState("2026-10-24T18:00:00", now)).toBe("overdue");
    expect(dueState("2026-10-25T18:00:00", now)).toBe("today");
    expect(dueState("2026-10-27T09:00:00", now)).toBe("upcoming");
    expect(dueState(null, now)).toBe("none");
  });
});
