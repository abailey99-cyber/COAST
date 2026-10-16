import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { DecryptError, KeyringError, decryptSecret, encryptSecret, parseKeyring, reencryptSecret } = await import("./crypto");

const k = () => randomBytes(32).toString("base64");
const owner = { orgId: "org-a", provider: "dhl", kind: "api_key" };
const SECRET = "test-value-xxxxxxxxxxxxxxxx"; // made up for the test

describe("credential encryption", () => {
  const k1 = k();
  const k2 = k();
  const ring1 = parseKeyring(`1:${k1}`);
  const ring12 = parseKeyring(`1:${k1},2:${k2}`);

  it("round-trips, and never stores the plaintext", () => {
    const { ciphertext, keyVersion } = encryptSecret(SECRET, owner, ring1);
    expect(keyVersion).toBe(1);
    expect(ciphertext).not.toContain(SECRET);
    expect(ciphertext).toMatch(/^v1\./);
    expect(decryptSecret(ciphertext, owner, ring1)).toBe(SECRET);
  });

  it("uses a fresh nonce every time", () => {
    expect(encryptSecret(SECRET, owner, ring1).ciphertext).not.toBe(encryptSecret(SECRET, owner, ring1).ciphertext);
  });

  it("rotates: new secrets use the newest key, old ones still read, and re-encrypt to the new key", () => {
    const old = encryptSecret(SECRET, owner, ring1).ciphertext;
    expect(encryptSecret(SECRET, owner, ring12).keyVersion).toBe(2);
    expect(decryptSecret(old, owner, ring12)).toBe(SECRET);
    const moved = reencryptSecret(old, owner, ring12)!;
    expect(moved.keyVersion).toBe(2);
    expect(decryptSecret(moved.ciphertext, owner, parseKeyring(`2:${k2}`))).toBe(SECRET);
    expect(reencryptSecret(moved.ciphertext, owner, ring12)).toBeNull();
  });

  it("refuses the wrong key, and a retired one", () => {
    const { ciphertext } = encryptSecret(SECRET, owner, ring1);
    expect(() => decryptSecret(ciphertext, owner, parseKeyring(`1:${k()}`))).toThrow(DecryptError);
    expect(() => decryptSecret(ciphertext, owner, parseKeyring(`2:${k2}`))).toThrow(/key 1, which isn't available/);
  });

  it("refuses a damaged record", () => {
    const { ciphertext } = encryptSecret(SECRET, owner, ring1);
    const parts = ciphertext.split(".");
    const flipped = parts[3]!.slice(0, -2) + (parts[3]!.slice(-2) === "AA" ? "AB" : "AA");
    expect(() => decryptSecret([...parts.slice(0, 3), flipped].join("."), owner, ring1)).toThrow(DecryptError);
    expect(() => decryptSecret("not a credential", owner, ring1)).toThrow(/damaged/);
    expect(() => decryptSecret(ciphertext.replace(/^v1\./, "v1.AAAA"), owner, ring1)).toThrow(DecryptError);
  });

  it("won't decrypt for another organisation, provider or kind (so a copied secret is useless)", () => {
    const { ciphertext } = encryptSecret(SECRET, owner, ring1);
    expect(() => decryptSecret(ciphertext, { ...owner, orgId: "org-b" }, ring1)).toThrow(DecryptError);
    expect(() => decryptSecret(ciphertext, { ...owner, provider: "fedex" }, ring1)).toThrow(DecryptError);
    expect(() => decryptSecret(ciphertext, { ...owner, kind: "oauth_client" }, ring1)).toThrow(DecryptError);
  });

  it("rejects a badly formed keyring, without echoing the key", () => {
    expect(() => parseKeyring("")).toThrow(KeyringError);
    expect(() => parseKeyring("1:short")).toThrow(/32 bytes/);
    try {
      parseKeyring("not-a-keyring-xxxxxx");
    } catch (e) {
      expect(String(e)).not.toContain("not-a-keyring-xxxxxx");
    }
  });
});
