import { describe, expect, it } from "vitest";
import {
  CUSTOMER_CUSTOMS_LINE,
  borderCheck,
  linesMissingHsCode,
  needsCustomsAttention,
  normaliseCountry,
  normaliseEori,
  normaliseHsCode,
  outstandingDocuments,
  requiredDocuments,
} from "./customs";
import {
  categoryFromCarrier,
  categoryFromCheckIn,
  claimDeadline,
  claimHealth,
  customerStatus,
  isOpen,
  nextStatuses,
  photoProblem,
  problemRates,
  safeFileName,
  sniffPhoto,
  validateReport,
  waitingOn,
} from "./problems";

const TODAY = "2026-10-15";

describe("delivery problems: status", () => {
  it("moves on from new, and can always reopen", () => {
    expect(nextStatuses("raised")).toContain("triage");
    expect(nextStatuses("raised")).not.toContain("raised");
    expect(nextStatuses("waiting_supplier")).not.toContain("raised");
    expect(nextStatuses("resolved")).toEqual(["closed", "triage"]);
    expect(nextStatuses("closed")).toEqual(["triage"]);
  });
  it("knows who it's waiting on", () => {
    expect(waitingOn("raised")).toBe("us");
    expect(waitingOn("waiting_supplier")).toBe("supplier");
    expect(waitingOn("waiting_customer")).toBe("customer");
    expect(waitingOn("resolved")).toBeNull();
    expect(isOpen("resolved")).toBe(false);
    expect(isOpen("waiting_carrier")).toBe(true);
  });
  it("never tells the customer it's waiting on a supplier or carrier", () => {
    for (const s of ["waiting_supplier", "waiting_carrier"] as const) {
      expect(customerStatus(s)).toBe("We're sorting it out");
      expect(customerStatus(s)).not.toMatch(/supplier|carrier/i);
    }
    expect(customerStatus("waiting_customer")).toMatch(/We need something from you/);
    expect(customerStatus("resolved")).toBe("Sorted");
  });
});

describe("delivery problems: where they come from", () => {
  it("reads a carrier's category only when it's unmistakable", () => {
    expect(categoryFromCarrier("Damaged in transit — returning to sender")).toBe("damaged");
    expect(categoryFromCarrier("Shipment lost")).toBe("not_received");
    expect(categoryFromCarrier("Partial delivery")).toBe("short");
    expect(categoryFromCarrier("Returned to sender")).toBe("other");
    expect(categoryFromCarrier(null)).toBe("other");
  });
  it("turns a bad check-in into a problem, but not a good one", () => {
    expect(categoryFromCheckIn("damaged")).toBe("damaged");
    expect(categoryFromCheckIn("wrong_item")).toBe("wrong_item");
    expect(categoryFromCheckIn("short")).toBe("short");
    expect(categoryFromCheckIn("ok")).toBeNull();
  });
});

describe("claim windows", () => {
  it("counts the deadline from delivery, and has none without a window", () => {
    expect(claimDeadline(7, "2026-10-12")).toBe("2026-10-19");
    expect(claimDeadline(null, "2026-10-12")).toBeNull();
    expect(claimDeadline(7, null)).toBeNull();
    expect(claimDeadline(0, "2026-10-12")).toBeNull();
  });
  it("goes amber, red and then needs attention as it runs out", () => {
    expect(claimHealth("2026-10-25", TODAY, false)).toEqual({ level: "none", label: "10 days left to claim" });
    expect(claimHealth("2026-10-20", TODAY, false)).toEqual({ level: "amber", label: "5 days left to claim" });
    expect(claimHealth("2026-10-16", TODAY, false)).toEqual({ level: "red", label: "1 day left to claim" });
    expect(claimHealth(TODAY, TODAY, false)).toEqual({ level: "red", label: "Last day to claim" });
    expect(claimHealth("2026-10-13", TODAY, false)).toEqual({ level: "alert", label: "Claim window closed 2 days ago" });
  });
  it("is fine once the claim is in, and says nothing without a deadline", () => {
    expect(claimHealth("2026-10-13", TODAY, true)).toEqual({ level: "none", label: "Claim submitted" });
    expect(claimHealth(null, TODAY, false)).toBeNull();
  });
});

describe("reporting a problem", () => {
  const lines = ["a", "b"];
  it("needs a category and a line from this order", () => {
    expect(validateReport({ category: "damaged", description: " Box crushed ", lineIds: ["a", "a", "zzz"] }, lines)).toEqual({ ok: true, value: { category: "damaged", description: "Box crushed", lineIds: ["a"] } });
    expect(validateReport({ category: "broken", description: "", lineIds: ["a"] }, lines)).toMatchObject({ ok: false });
    expect(validateReport({ category: "damaged", description: "", lineIds: ["zzz"] }, lines)).toMatchObject({ ok: false });
  });
  it("needs a few words for 'something else'", () => {
    expect(validateReport({ category: "other", description: "  ", lineIds: ["a"] }, lines)).toMatchObject({ ok: false });
  });
});

describe("photos", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
  it("knows a photo by its first bytes, not its name", () => {
    expect(sniffPhoto(jpeg)).toEqual({ contentType: "image/jpeg", extension: "jpg" });
    expect(sniffPhoto(png)).toEqual({ contentType: "image/png", extension: "png" });
    expect(sniffPhoto(webp)).toEqual({ contentType: "image/webp", extension: "webp" });
    expect(sniffPhoto(new Uint8Array([...Buffer.from("<svg>")]))).toBeNull();
    expect(sniffPhoto(new Uint8Array([...Buffer.from("%PDF-1.7")]))).toBeNull();
  });
  it("refuses empty, huge or non-photo files", () => {
    expect(photoProblem(0, sniffPhoto(jpeg))).toMatch(/empty/);
    expect(photoProblem(11 * 1024 * 1024, sniffPhoto(jpeg))).toMatch(/10 MB/);
    expect(photoProblem(100, null)).toMatch(/JPEG, PNG or WebP/);
    expect(photoProblem(100, sniffPhoto(png))).toBeNull();
  });
  it("tidies file names", () => {
    expect(safeFileName("C:\\Users\\jo\\IMG 001 (copy).jpg")).toBe("IMG 001 _copy_.jpg");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("")).toBe("photo");
  });
});

describe("problem rates", () => {
  it("rates per 100 delivered, worst first, and says when there's too little to tell", () => {
    expect(problemRates([
      { key: "a", name: "Alpha", delivered: 20, problems: 1 },
      { key: "b", name: "Beta", delivered: 10, problems: 3 },
      { key: "c", name: "Gamma", delivered: 2, problems: 2 },
    ])).toEqual([
      { key: "b", name: "Beta", delivered: 10, problems: 3, ratePercent: 30 },
      { key: "a", name: "Alpha", delivered: 20, problems: 1, ratePercent: 5 },
      { key: "c", name: "Gamma", delivered: 2, problems: 2, ratePercent: null },
    ]);
  });
});

describe("customs: borders", () => {
  it("treats abroad as international and the mainland as not", () => {
    expect(borderCheck("IE", "D02", true)).toEqual({ international: true, territory: false });
    expect(borderCheck("GB", "NG24 1AB", true)).toEqual({ international: false, territory: false });
  });
  it("flags Northern Ireland and the Crown Dependencies for a person to confirm, following the company setting (C6)", () => {
    expect(borderCheck("GB", "BT1 5GS", true)).toEqual({ international: true, territory: true });
    expect(borderCheck("GB", "BT1 5GS", false)).toEqual({ international: false, territory: true });
    expect(borderCheck("JE", "JE2 3AB", true)).toEqual({ international: true, territory: true });
    expect(borderCheck("IM", "IM1 1AA", false)).toEqual({ international: false, territory: true });
  });
});

describe("customs: documents", () => {
  const plain = { countryOfOrigin: null, dangerousGoods: null, hsCode: "84713000" };
  it("starts the checklist from the shipment and its lines", () => {
    expect(requiredDocuments("outbound", [plain])).toEqual(["commercial_invoice", "packing_list", "export_declaration"]);
    expect(requiredDocuments("inbound", [plain])).toEqual(["commercial_invoice", "packing_list", "import_declaration"]);
    expect(requiredDocuments("direct", [{ ...plain, countryOfOrigin: "CN" }, { ...plain, dangerousGoods: "UN1263 paint" }])).toEqual([
      "commercial_invoice", "packing_list", "export_declaration", "certificate_of_origin", "dangerous_goods_note",
    ]);
    expect(requiredDocuments("outbound", [{ ...plain, countryOfOrigin: "GB" }])).not.toContain("certificate_of_origin");
  });
  it("lists what's outstanding and which lines lack an HS code", () => {
    expect(outstandingDocuments([
      { docType: "commercial_invoice", required: true, receivedAt: "2026-10-14T10:00:00Z" },
      { docType: "packing_list", required: true, receivedAt: null },
      { docType: "other", required: false, receivedAt: null },
    ])).toEqual(["packing_list"]);
    expect(linesMissingHsCode([{ ...plain, lineNo: 1 }, { ...plain, hsCode: null, lineNo: 2 }])).toEqual([2]);
  });
  it("knows when customs needs someone's attention", () => {
    const base = { international: true, delivered: false, customsStatus: "cleared", territoryUnconfirmed: false, outstandingDocs: 0 };
    expect(needsCustomsAttention(base)).toBe(false);
    expect(needsCustomsAttention({ ...base, customsStatus: "held" })).toBe(true);
    expect(needsCustomsAttention({ ...base, customsStatus: "unknown" })).toBe(true);
    expect(needsCustomsAttention({ ...base, outstandingDocs: 1 })).toBe(true);
    expect(needsCustomsAttention({ ...base, international: false, territoryUnconfirmed: true })).toBe(true);
    expect(needsCustomsAttention({ ...base, customsStatus: "held", delivered: true })).toBe(false);
    expect(needsCustomsAttention({ ...base, international: false, customsStatus: "unknown" })).toBe(false);
  });
});

describe("customs: numbers and codes", () => {
  it("tidies and checks what staff type", () => {
    expect(normaliseEori(" gb 123 456 789 000 ")).toBe("GB123456789000");
    expect(normaliseEori("")).toBeNull();
    expect(normaliseEori("123")).toBe("invalid");
    expect(normaliseHsCode("8471.30.00")).toBe("84713000");
    expect(normaliseHsCode("84")).toBe("invalid");
    expect(normaliseCountry("cn")).toBe("CN");
    expect(normaliseCountry("China")).toBe("invalid");
  });
  it("uses the approved customer wording for a customs hold (C7)", () => {
    expect(CUSTOMER_CUSTOMS_LINE).toBe("Customs checks in progress — we're on it.");
  });
});
