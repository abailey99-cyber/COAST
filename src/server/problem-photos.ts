import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertProblemEvent, storePhoto } from "@/lib/data/problems";
import { MAX_PHOTOS, photoProblem, safeFileName, sniffPhoto, type PhotoType } from "@/lib/logic/problems";

/**
 * Photos on a delivery problem (decision B13). Each file is checked by its
 * first bytes (never its name or the browser's word), size-limited, and
 * stored in a private bucket; viewing is by short-lived link only.
 */

export interface CheckedPhoto {
  bytes: Uint8Array;
  type: PhotoType;
  name: string;
}

/** The photos in a form, checked. `already` is how many the problem has. */
export async function readPhotos(formData: FormData, already = 0): Promise<{ ok: true; photos: CheckedPhoto[] } | { ok: false; error: string }> {
  const files = formData.getAll("photos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  if (files.length === 0) return { ok: true, photos: [] };
  if (already + files.length > MAX_PHOTOS) return { ok: false, error: `Up to ${MAX_PHOTOS} photos per problem${already ? ` (it has ${already} already)` : ""}.` };
  const photos: CheckedPhoto[] = [];
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) return { ok: false, error: `${safeFileName(f.name)}: photos must be 10 MB or smaller.` };
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = sniffPhoto(bytes);
    const problem = photoProblem(bytes.byteLength, type);
    if (problem || !type) return { ok: false, error: `${safeFileName(f.name)}: ${problem ?? "not a photo."}` };
    photos.push({ bytes, type, name: safeFileName(f.name) });
  }
  return { ok: true, photos };
}

/** Store checked photos against a problem. Returns how many were saved. */
export async function savePhotos(admin: SupabaseClient, orgId: string, problemId: string, photos: readonly CheckedPhoto[], by: { kind: "customer" | "staff"; userId: string | null }): Promise<number> {
  let saved = 0;
  for (const p of photos) {
    try {
      await storePhoto(admin, { orgId, problemId, bytes: p.bytes, contentType: p.type.contentType, extension: p.type.extension, fileName: p.name, uploadedByKind: by.kind, uploadedBy: by.userId });
      await insertProblemEvent(admin, problemId, "photo", { name: p.name, by: by.kind }, by.userId);
      saved++;
    } catch (e) {
      console.warn("[problems] couldn't store a photo", e instanceof Error ? e.message : e);
    }
  }
  return saved;
}
