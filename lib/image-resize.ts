// Browser-only: shrinks large photos before upload so the catalog stays light and fast.
// Phone photos are often 3-8 MB; a 1600 px JPEG is usually 150-400 KB and looks the same on screen.
const MAX_SIDE = 1600;
const KEEP_IF_UNDER = 350 * 1024;

export async function shrinkImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file; // keep animation
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= KEEP_IF_UNDER) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff"; // transparent PNGs get a white background instead of black
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || (blob.size >= file.size && scale === 1)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

// Shrinks every file, keeping the original when it cannot be decoded (the server still validates it).
export async function shrinkAll(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    try { out.push(await shrinkImage(file)); } catch { out.push(file); }
  }
  return out;
}
