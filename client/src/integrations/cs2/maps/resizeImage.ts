/* eslint-disable no-undef -- DOM types are checked by tsc */
const loadBitmap = async (file: Blob): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

const makeCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * Cover-crops the image to the width:height ratio and encodes it as a webp
 * data URL. Never upscales: the output is clamped to the cropped source size.
 */
export async function resizeToWebp(
  file: Blob,
  width: number,
  height: number,
  quality: number
): Promise<string> {
  const bitmap = await loadBitmap(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  const targetRatio = width / height;
  let cropW = srcW;
  let cropH = srcH;
  if (srcW / srcH > targetRatio) {
    cropW = Math.round(srcH * targetRatio);
  } else {
    cropH = Math.round(srcW / targetRatio);
  }
  const cropX = Math.floor((srcW - cropW) / 2);
  const cropY = Math.floor((srcH - cropH) / 2);

  const scale = Math.min(1, width / cropW);
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  let source: CanvasImageSource = bitmap;
  let sx = cropX;
  let sy = cropY;
  let sw = cropW;
  let sh = cropH;

  // Halve until within 2x of the target; a single large downscale aliases
  while (sw >= outW * 2 && sh >= outH * 2) {
    const stepW = Math.max(outW, Math.floor(sw / 2));
    const stepH = Math.max(outH, Math.floor(sh / 2));
    const step = makeCanvas(stepW, stepH);
    const stepCtx = step.getContext('2d');
    if (!stepCtx) throw new Error('Canvas is not available');
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(source, sx, sy, sw, sh, 0, 0, stepW, stepH);
    source = step;
    sx = 0;
    sy = 0;
    sw = stepW;
    sh = stepH;
  }

  const canvas = makeCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);

  if ('close' in bitmap) bitmap.close();

  const dataUrl = canvas.toDataURL('image/webp', quality);
  if (!dataUrl.startsWith('data:image/webp')) {
    throw new Error('Browser cannot encode webp');
  }
  return dataUrl;
}
