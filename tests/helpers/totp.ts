import { createHmac } from "node:crypto";

/** The 6-digit code an authenticator app shows for a base32 secret (RFC 6238, SHA-1, 30 seconds). For tests only. */
export function totp(secretBase32: string, at: Date = new Date(), stepSeconds = 30): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secretBase32.replace(/=+$/, "").toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / stepSeconds)));
  const h = createHmac("sha1", key).update(counter).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const n = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

/** A code that won't change before the server checks it: waits out the last few seconds of a window. */
export async function freshTotp(secretBase32: string, stepSeconds = 30): Promise<string> {
  const left = stepSeconds * 1000 - (Date.now() % (stepSeconds * 1000));
  if (left < 5000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(secretBase32);
}

/** Wait until a fresh 30-second window, so a code isn't reused. */
export async function nextWindow(stepSeconds = 30): Promise<void> {
  const ms = stepSeconds * 1000 - (Date.now() % (stepSeconds * 1000)) + 200;
  await new Promise((r) => setTimeout(r, ms));
}
