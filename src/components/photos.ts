/**
 * Shrinking photos in the browser before they're sent (delivery problems).
 * Phone photos are often 3–8 MB; a request can carry about 4 MB, so each
 * photo is redrawn at most 2000px on its longest side as a JPEG. Anything
 * the browser can't decode goes up as it is, and the server — which checks
 * every file's real type — decides.
 */

const MAX_SIDE = 2000;
const SHRINK_OVER_BYTES = 900 * 1024;
/** What one submit may carry in photos, leaving room for the rest of the form. */
export const MAX_TOTAL_PHOTO_BYTES = 3.5 * 1024 * 1024;

async function shrink(file: File): Promise<File> {
  if (file.size <= SHRINK_OVER_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** The same form, with its "photos" shrunk. Returns an error message instead if they're still too big together. */
export async function withShrunkPhotos(formData: FormData): Promise<FormData | string> {
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  formData.delete("photos");
  let total = 0;
  for (const f of files) {
    const small = await shrink(f);
    total += small.size;
    formData.append("photos", small);
  }
  if (total > MAX_TOTAL_PHOTO_BYTES) return "Those photos are too big to send together. Try fewer, or add more afterwards.";
  return formData;
}
