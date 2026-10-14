import { describe, expect, it } from "vitest";
import { cleanEmail, findDates, findPoNumbers, findPrices, findTrackingNumbers, readSupplierEmail, scoreExtraction } from "./email-reading";

const NOW = new Date("2026-10-14T10:00:00Z");
const ctx = { poNumber: "PO-5001", lineCount: 1, currency: "GBP" as const };

describe("cleanEmail", () => {
  it("keeps the subject, drops headers and the quoted original", () => {
    const raw = [
      "From: Supplier <orders@supplier.test>",
      "Sent: 14 October 2026 09:12",
      "To: po-confirm@buyer.test",
      "Subject: RE: Purchase order PO-5001",
      "",
      "Hi, confirmed for delivery 16/10/2026.",
      "Thanks",
      "",
      "-----Original Message-----",
      "From: Buyer",
      "Please deliver by 20/10/2026",
    ].join("\n");
    expect(cleanEmail(raw)).toEqual({ subject: "RE: Purchase order PO-5001", body: "Hi, confirmed for delivery 16/10/2026.\nThanks" });
  });

  it("stops at 'On … wrote:' and > quotes", () => {
    expect(cleanEmail("Yes, Friday.\nOn Mon, 13 Oct 2026 at 10:00, Buyer wrote:\n> old").body).toBe("Yes, Friday.");
    expect(cleanEmail("Fine\n> quoted").body).toBe("Fine");
  });
});

describe("findDates", () => {
  it.each([
    ["delivery 16/10/2026", "2026-10-16"],
    ["delivery 16/10/26", "2026-10-16"],
    ["delivery 16.10.2026", "2026-10-16"],
    ["delivery 2026-10-16", "2026-10-16"],
    ["arriving Thursday 16th October", "2026-10-16"],
    ["arriving 16 Oct", "2026-10-16"],
    ["arriving October 16th, 2026", "2026-10-16"],
    ["ship on 3rd of November", "2026-11-03"],
    ["by 5 Jan", "2027-01-05"],
    ["ready 16/10", "2026-10-16"],
  ])("%s → %s", (text, isoDate) => {
    expect(findDates(text, NOW).map((d) => d.iso)).toEqual([isoDate]);
  });

  it("reads day-first, the UK way", () => {
    expect(findDates("03/04/2027", NOW)[0]!.iso).toBe("2027-04-03");
  });

  it("doesn't read prices or decimals as dates", () => {
    expect(findDates("£3.10 each, 2.5 kg, 1.12m", NOW)).toEqual([]);
  });

  it("ignores impossible dates", () => {
    expect(findDates("31/02/2026 or 45 Oct", NOW)).toEqual([]);
  });

  it("returns each distinct date once", () => {
    expect(findDates("16 Oct (16/10/2026) or 20 Oct", NOW).map((d) => d.iso)).toEqual(["2026-10-16", "2026-10-20"]);
  });
});

describe("other details", () => {
  it("finds PO numbers in various styles", () => {
    expect(findPoNumbers("Re PO 5001 and PO#5002 and po-5003")).toEqual(["PO-5001", "PO-5002", "PO-5003"]);
  });

  it("finds prices with currencies", () => {
    expect(findPrices("Price £1,250.50 each, or EUR 12 / 9.99 USD")).toEqual([
      { minor: 125050, currency: "GBP", text: "£1,250.50" },
      { minor: 1200, currency: "EUR", text: "EUR 12" },
      { minor: 999, currency: "USD", text: "9.99 USD" },
    ]);
  });

  it("finds tracking numbers: UPS by shape, others only when labelled", () => {
    expect(findTrackingNumbers("UPS 1Z999AA10123456784, tracking no: 1234567890, call 0123456789")).toEqual([
      { number: "1Z999AA10123456784", carrier: "UPS" },
      { number: "1234567890", carrier: null },
    ]);
  });
});

describe("scoreExtraction", () => {
  const read = (text: string) => readSupplierEmail(text, NOW);

  it("is high confidence for a clear, matching single-line confirmation", () => {
    const s = scoreExtraction(read("Subject: RE: PO-5001\n\nConfirmed, delivery Thursday 16th October."), ctx);
    expect(s).toMatchObject({ confidence: "high", date: "2026-10-16", reasons: [] });
  });

  it("is low when it's about a different PO", () => {
    expect(scoreExtraction(read("PO-5009 confirmed for 16/10/2026"), ctx).confidence).toBe("low");
  });

  it("is low when it says it can't supply or is delayed", () => {
    expect(scoreExtraction(read("Sorry, this is delayed until 30/10/2026"), ctx).confidence).toBe("low");
    expect(scoreExtraction(read("We can't supply this, out of stock"), ctx).confidence).toBe("low");
  });

  it("is low with no date at all, medium with a vague one", () => {
    expect(scoreExtraction(read("Confirmed, thanks"), ctx).confidence).toBe("low");
    const vague = scoreExtraction(read("Confirmed, should ship next week"), ctx);
    expect(vague.confidence).toBe("medium");
    expect(vague.reasons.join(" ")).toMatch(/vague/);
  });

  it("is medium for two dates, partial deliveries, no clear confirmation, or several lines (B15)", () => {
    expect(scoreExtraction(read("Confirmed: 16/10/2026 or 20/10/2026"), ctx).confidence).toBe("medium");
    expect(scoreExtraction(read("Confirmed, only 3 on 16/10/2026, balance to follow"), ctx).confidence).toBe("medium");
    expect(scoreExtraction(read("Delivery 16/10/2026"), ctx).confidence).toBe("medium");
    expect(scoreExtraction(read("Confirmed for 16/10/2026"), { ...ctx, lineCount: 2 }).confidence).toBe("medium");
  });

  it("flags a price in the wrong currency", () => {
    const s = scoreExtraction(read("Confirmed 16/10/2026 at €12.00"), ctx);
    expect(s.confidence).toBe("medium");
    expect(s.price).toEqual({ minor: 1200, currency: "EUR", text: "€12.00" });
  });

  it("ignores the requested date in the quoted original PO", () => {
    const s = scoreExtraction(read("Confirmed for 16/10/2026\n\n-----Original Message-----\nPlease deliver by 20/10/2026"), ctx);
    expect(s).toMatchObject({ confidence: "high", date: "2026-10-16" });
  });
});
