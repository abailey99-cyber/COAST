import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypting integration credentials (readiness plan Task 2, decision N3).
 *
 * AES-256-GCM with a random 96-bit nonce per secret. The master keys live
 * only in the hosting settings (`COAST_CREDENTIAL_KEYS`), never in the
 * database, so a backup or a database leak holds nothing usable.
 *
 * Every secret is bound to who it belongs to (organisation, provider and
 * kind, as GCM "associated data"): a ciphertext copied into another
 * organisation's row won't decrypt. Each record stores its key version, so
 * keys can be rotated: add a new key, re-encrypt, then retire the old one.
 *
 * Stored form: `v<version>.<nonce>.<tag>.<ciphertext>` (base64url parts).
 * Nothing here ever logs a key or a plaintext.
 */

export interface Keyring {
  /** The version new secrets are encrypted with (the highest). */
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

export class KeyringError extends Error {}
export class DecryptError extends Error {}

/** Where a secret belongs. Part of the encryption, so it can't be moved. */
export interface SecretOwner {
  orgId: string;
  provider: string;
  kind: string;
}

const aad = (o: SecretOwner) => Buffer.from(`coast-credential:${o.orgId}:${o.provider}:${o.kind}`, "utf8");

/**
 * `COAST_CREDENTIAL_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"`. The highest
 * version is current; older ones stay only until everything is re-encrypted.
 */
export function parseKeyring(value: string | undefined): Keyring {
  const keys = new Map<number, Buffer>();
  for (const part of (value ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{1,4}):([A-Za-z0-9+/=_-]+)$/);
    if (!m) throw new KeyringError("COAST_CREDENTIAL_KEYS: each entry must look like 1:<base64 key>.");
    const key = Buffer.from(m[2]!, "base64");
    if (key.length !== 32) throw new KeyringError(`COAST_CREDENTIAL_KEYS: key ${m[1]} must be 32 bytes (base64 of 32 random bytes).`);
    keys.set(Number(m[1]), key);
  }
  if (keys.size === 0) throw new KeyringError("COAST_CREDENTIAL_KEYS isn't set, so integration credentials can't be stored.");
  return { current: Math.max(...keys.keys()), keys };
}

let cached: { raw: string | undefined; ring: Keyring } | null = null;

/** The keyring from the hosting settings, or null when it isn't set (integrations then show as unconfigured). */
export function keyringFromEnv(): Keyring | null {
  const raw = process.env.COAST_CREDENTIAL_KEYS;
  if (cached && cached.raw === raw) return cached.ring;
  try {
    cached = { raw, ring: parseKeyring(raw) };
    return cached.ring;
  } catch {
    return null;
  }
}

export function encryptSecret(plaintext: string, owner: SecretOwner, ring: Keyring): { ciphertext: string; keyVersion: number } {
  const key = ring.keys.get(ring.current)!;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(owner));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: `v${ring.current}.${nonce.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`, keyVersion: ring.current };
}

/** The plaintext, or a DecryptError (wrong key, retired key, wrong owner, or a damaged record) — never a partial value. */
export function decryptSecret(ciphertext: string, owner: SecretOwner, ring: Keyring): string {
  const m = ciphertext.match(/^v(\d{1,4})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]*)$/);
  if (!m) throw new DecryptError("The stored credential is damaged.");
  const key = ring.keys.get(Number(m[1]));
  if (!key) throw new DecryptError(`The stored credential uses key ${m[1]}, which isn't available.`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(m[2]!, "base64url"));
    decipher.setAAD(aad(owner));
    decipher.setAuthTag(Buffer.from(m[3]!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(m[4]!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptError("The stored credential couldn't be decrypted.");
  }
}

/** Re-encrypt under the current key (rotation). Returns null when it's already current. */
export function reencryptSecret(ciphertext: string, owner: SecretOwner, ring: Keyring): { ciphertext: string; keyVersion: number } | null {
  if (ciphertext.startsWith(`v${ring.current}.`)) return null;
  return encryptSecret(decryptSecret(ciphertext, owner, ring), owner, ring);
}

/** A fresh random key, for setting up COAST_CREDENTIAL_KEYS. */
export function newMasterKey(): string {
  return randomBytes(32).toString("base64");
}
