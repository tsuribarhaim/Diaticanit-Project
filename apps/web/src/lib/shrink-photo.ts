/** Phone cameras produce 3-12 MB photos. The chat sends the picture inside the request, where it grows by about a third (base64), and the
 * hosting platform refuses requests above roughly 4.5 MB - the request then fails before any analysis happens. Food needs far less detail
 * than that, so the photo is shrunk on the phone first: at most 1600 px on the long side, saved as JPEG. Browser-only (canvas).
 *
 * Never throws: if the browser cannot decode the picture (some formats) or the result would not be smaller, the original file is returned
 * and the caller carries on exactly as before. */

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;
/** A picture already small in both pixels and bytes is left alone (no needless re-compression). */
const LEAVE_ALONE_BYTES = 1_200_000;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void } | null> {
  try {
    // imageOrientation: phones often store the photo sideways with a rotation flag; this applies it so the result is upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // Older browsers: fall back to an <img> element.
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) });
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      image.src = url;
    });
  }
}

export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const decoded = await decode(file);
    if (!decoded || decoded.width === 0 || decoded.height === 0) return file;
    const { source, width, height, release } = decoded;
    try {
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      if (scale === 1 && file.size <= LEAVE_ALONE_BYTES) return file;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      // JPEG has no transparency: a transparent PNG would turn black without a white backing.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
      if (!blob || blob.size >= file.size) return file;
      const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } finally {
      release();
    }
  } catch {
    return file;
  }
}
