import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { parseMailgunForm, verifyMailgunSignature } = await import("./mailgun");

const KEY = "test-signing-key-xxxxxxxx"; // made up for the test
const sign = (key: string, ts: string, token: string) => createHmac("sha256", key).update(ts + token).digest("hex");

describe("Mailgun webhook signatures", () => {
  it("accepts Mailgun's own signature", () => {
    expect(verifyMailgunSignature(KEY, "1792170000", "tok-1", sign(KEY, "1792170000", "tok-1"))).toBe(true);
  });
  it("refuses a wrong key, a changed timestamp or token, or rubbish", () => {
    const good = sign(KEY, "1792170000", "tok-1");
    expect(verifyMailgunSignature("another-key-xxxxxxxx", "1792170000", "tok-1", good)).toBe(false);
    expect(verifyMailgunSignature(KEY, "1792170001", "tok-1", good)).toBe(false);
    expect(verifyMailgunSignature(KEY, "1792170000", "tok-2", good)).toBe(false);
    expect(verifyMailgunSignature(KEY, "1792170000", "tok-1", "nothex")).toBe(false);
    expect(verifyMailgunSignature("", "1792170000", "tok-1", good)).toBe(false);
  });
});

describe("reading Mailgun's form", () => {
  it("takes the recipient, sender, headers and text", () => {
    const f = new FormData();
    f.set("recipient", "r-0123456789abcdef0123456789abcd@replies.coast.test");
    f.set("sender", "SRS0=x=yy=supplier.test=jo@yourco.co.uk");
    f.set("from", "Jo <jo@supplier.test>");
    f.set("subject", "RE: Purchase order PO-5017");
    f.set("body-plain", "Confirmed for Friday 23 October.");
    f.set("message-headers", JSON.stringify([["Authentication-Results", "spf=pass"], ["Message-Id", "<abc@supplier.test>"], ["bad"]]));
    expect(parseMailgunForm(f)).toEqual({
      recipient: "r-0123456789abcdef0123456789abcd@replies.coast.test",
      envelopeSender: "SRS0=x=yy=supplier.test=jo@yourco.co.uk",
      from: "Jo <jo@supplier.test>",
      subject: "RE: Purchase order PO-5017",
      text: "Confirmed for Friday 23 October.",
      headers: [["Authentication-Results", "spf=pass"], ["Message-Id", "<abc@supplier.test>"]],
      messageId: "<abc@supplier.test>",
    });
  });
  it("copes with missing or broken headers", () => {
    const f = new FormData();
    f.set("message-headers", "{not json");
    expect(parseMailgunForm(f)).toMatchObject({ headers: [], messageId: null, recipient: "", from: null });
  });
});
