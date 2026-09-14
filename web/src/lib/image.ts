const MAX_DIMENSION = 1280;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = dataUrl;
  });
}

/**
 * Auto-enhances a photo for a listing: samples average brightness to decide how much of
 * a lift it needs, then re-renders through canvas filters (contrast/saturation/brightness)
 * so the exported JPEG actually has the enhanced pixels baked in, not just a CSS overlay.
 */
export async function enhanceDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  // Sample (unfiltered) to estimate average luminance, so a dim phone photo gets a real
  // brightness lift while an already-bright one doesn't get blown out.
  ctx.drawImage(img, 0, 0);
  const sampleSize = Math.min(canvas.width, canvas.height, 64);
  const sample = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
  let total = 0;
  const pixelCount = sample.length / 4;
  for (let i = 0; i < sample.length; i += 4) {
    total += 0.299 * sample[i] + 0.587 * sample[i + 1] + 0.114 * sample[i + 2];
  }
  const avgLuminance = total / pixelCount;
  const brightnessPct = avgLuminance < 80 ? 122 : avgLuminance < 130 ? 110 : 102;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = `contrast(112%) saturate(114%) brightness(${brightnessPct}%)`;
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** Reads a File, downsizes it so uploads stay fast and cheap, and returns a JPEG data URL. */
export function fileToResizedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read the image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
