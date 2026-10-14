import { describe, expect, it } from "vitest";
import { buildChaseEmail, buildPoEmail, escapeHtml } from "./po-email";

const base = {
  to: "orders@supplier.test",
  buyerName: "[Demo Org A]",
  supplierName: "[Demo Supplier One]",
  poNumber: "PO-5001",
  lines: [{ description: "Shelving <unit>", sku: "SHF-200", quantity: 4, requestedDate: "2026-10-20" }],
  deliverTo: null,
  confirmUrl: "https://coast.test/confirm/abc",
  linkExpires: "Fri 13 Nov",
};

describe("buildPoEmail", () => {
  it("says what's ordered, how to confirm and until when", () => {
    const m = buildPoEmail(base);
    expect(m.subject).toBe("Purchase order PO-5001 from [Demo Org A]");
    expect(m.text).toContain("- 4 × Shelving <unit> (SHF-200) — needed by Tue 20 Oct");
    expect(m.text).toContain("https://coast.test/confirm/abc");
    expect(m.text).toContain("until Fri 13 Nov");
    expect(m.html).toContain('href="https://coast.test/confirm/abc"');
  });

  it("escapes anything that could break the HTML", () => {
    expect(buildPoEmail(base).html).toContain("Shelving &lt;unit&gt;");
    expect(buildPoEmail(base).html).not.toContain("<unit>");
    expect(escapeHtml(`"a"&'b'`)).toBe("&quot;a&quot;&amp;&#39;b&#39;");
  });

  it("includes the delivery address only for direct-ship POs", () => {
    expect(buildPoEmail(base).text).not.toContain("Deliver to");
    expect(buildPoEmail({ ...base, deliverTo: "[Customer A] Goods In, Newark NG24 1AB" }).text).toContain("Deliver to: [Customer A] Goods In");
  });
});

describe("buildChaseEmail", () => {
  it("reminds politely, with the link when there is one", () => {
    const m = buildChaseEmail({ to: base.to, buyerName: base.buyerName, supplierName: base.supplierName, poNumber: "PO-5001", sentOn: "Mon 12 Oct", confirmUrl: base.confirmUrl, chaseNumber: 1 });
    expect(m.subject).toBe("Reminder: please confirm purchase order PO-5001");
    expect(m.text).toContain("sent purchase order PO-5001 on Mon 12 Oct");
    expect(m.text).toContain(base.confirmUrl);
    expect(m.text).not.toContain("follow-up");
  });

  it("asks for a reply when there's no link, and says when it's a follow-up", () => {
    const m = buildChaseEmail({ to: base.to, buyerName: base.buyerName, supplierName: base.supplierName, poNumber: "PO-5001", sentOn: "Mon 12 Oct", confirmUrl: null, chaseNumber: 2 });
    expect(m.text).toContain("Please reply with your confirmed delivery date");
    expect(m.text).toContain("follow-up");
  });
});
