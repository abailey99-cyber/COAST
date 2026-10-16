import { describe, expect, it } from "vitest";
import { PROVIDERS, secretHint, validateCredentialInput } from "./integrations";

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";

describe("connecting an integration", () => {
  it("needs every part of a carrier's credentials, and hints only the last four characters", () => {
    expect(validateCredentialInput(PROVIDERS.dhl, { apiKey: "  abcdefghijklmnop1234 " })).toEqual({ ok: true, config: {}, secret: { apiKey: "abcdefghijklmnop1234" }, hint: "…1234" });
    expect(validateCredentialInput(PROVIDERS.fedex, { clientId: "id-123" })).toEqual({ ok: false, errors: { clientSecret: "Enter the secret key." } });
  });

  it("makes UPS's written consent explicit", () => {
    expect(validateCredentialInput(PROVIDERS.ups, { clientId: "a", clientSecret: "b" })).toMatchObject({ ok: false, errors: { consent: expect.stringMatching(/agreed in writing/) } });
    expect(validateCredentialInput(PROVIDERS.ups, { clientId: "a", clientSecret: "b" }, { consent: true })).toMatchObject({ ok: true });
  });

  it("checks NetSuite's settings and private key, keeping the key out of the hint", () => {
    const good = { accountId: "1234567_SB1", clientId: "c", certificateId: "cert", algorithm: "PS256", privateKey: PEM };
    const r = validateCredentialInput(PROVIDERS.netsuite, good);
    expect(r).toMatchObject({ ok: true, config: { accountId: "1234567_SB1", algorithm: "PS256" }, secret: { privateKey: PEM }, hint: null });
    expect(validateCredentialInput(PROVIDERS.netsuite, { ...good, algorithm: "HS256" })).toMatchObject({ ok: false, errors: { algorithm: expect.any(String) } });
    expect(validateCredentialInput(PROVIDERS.netsuite, { ...good, privateKey: "not a key" })).toMatchObject({ ok: false, errors: { privateKey: expect.stringMatching(/BEGIN and END/) } });
    expect(validateCredentialInput(PROVIDERS.netsuite, { ...good, accountId: "12 34" })).toMatchObject({ ok: false });
  });

  it("stores only settings for Microsoft 365 (COAST's own app signs in after consent)", () => {
    expect(validateCredentialInput(PROVIDERS.microsoft365, { tenantId: "11111111-2222-3333-4444-555555555555", mailbox: "purchasing@example.test" })).toEqual({
      ok: true,
      config: { tenantId: "11111111-2222-3333-4444-555555555555", mailbox: "purchasing@example.test" },
      secret: null,
      hint: null,
    });
    expect(validateCredentialInput(PROVIDERS.microsoft365, { tenantId: "nope", mailbox: "x" })).toMatchObject({ ok: false });
  });

  it("on rotation, keeps the stored secret when left blank, but wants all of it if any is changed", () => {
    expect(validateCredentialInput(PROVIDERS.fedex, {}, { rotating: true })).toEqual({ ok: true, config: {}, secret: null, hint: null });
    expect(validateCredentialInput(PROVIDERS.fedex, { clientSecret: "new" }, { rotating: true })).toMatchObject({ ok: false, errors: { clientId: expect.any(String) } });
  });

  it("gives no hint for short secrets", () => {
    expect(secretHint({ apiKey: "short" }, PROVIDERS.dhl)).toBeNull();
  });
});
