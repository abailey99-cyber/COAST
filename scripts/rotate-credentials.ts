/**
 * Re-encrypt every stored integration credential with the newest key in
 * COAST_CREDENTIAL_KEYS (readiness plan Task 2).
 *
 *   npm run credentials:rotate            (shows what it would do)
 *   npm run credentials:rotate -- --apply (does it)
 *
 * To rotate: add a new key (e.g. "1:<old>,2:<new>"), run this with --apply,
 * check it reports nothing left on the old key, then remove the old key.
 * Never prints a key or a secret. Each re-encryption is logged as a
 * security event by the database.
 */

import { listAllCiphertexts, saveReencrypted } from "../src/lib/data/credentials";
import { keyringFromEnv, reencryptSecret } from "../src/lib/secrets/crypto";
import { adminClient, fail } from "./lib/admin";

async function main() {
  const apply = process.argv.includes("--apply");
  const ring = keyringFromEnv();
  if (!ring) fail("COAST_CREDENTIAL_KEYS isn't set (or isn't valid).");
  const admin = adminClient();
  const all = await listAllCiphertexts(admin);
  let moved = 0;
  let current = 0;
  let broken = 0;
  for (const c of all) {
    try {
      const next = reencryptSecret(c.ciphertext, { orgId: c.orgId, provider: c.provider, kind: c.kind }, ring);
      if (!next) {
        current++;
        continue;
      }
      if (apply) await saveReencrypted(admin, c.orgId, c.id, next.ciphertext, next.keyVersion);
      moved++;
    } catch {
      broken++;
      console.log(`  ✗ ${c.provider} for organisation ${c.orgId}: can't be decrypted with any key here (it must be reconnected)`);
    }
  }
  console.log(`\n${all.length} stored credentials · ${current} already on key ${ring.current} · ${moved} ${apply ? "re-encrypted" : "to re-encrypt"} · ${broken} unreadable`);
  if (!apply && moved > 0) console.log("Run again with --apply to re-encrypt them.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
