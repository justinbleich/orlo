/**
 * DOM-free image registration for the Phase 0 fidelity diff.
 *
 * The canvas snapshot is a tight crop of the card; the simulator screenshot is a
 * full device screen with the card centered on a grey background. Comparing them
 * directly makes the score a function of margins and misalignment, not render
 * fidelity. These helpers crop both images to the card and resample them to a
 * common size so the diff measures like-for-like. Pure typed-array math so the
 * same code runs in the browser (studio) and in Node (the CLI).
 */

export type RawImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
 * Crop to the bounding box of the white card (#ffffff). The screen background
 * (#f0f0f0 = 240) and border (#e0e0e0 = 224) fall below the threshold, so the
 * status bar and margins don't pollute the bbox; padding re-includes the border.
 */
export function cropToContent(img: RawImage, pad?: number): RawImage {
  const { data, width, height } = img;

  const isCard = (i: number) =>
    data[i] >= 248 &&
    data[i + 1] >= 248 &&
    data[i + 2] >= 248 &&
    data[i + 3] >= 250;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isCard((y * width + x) * 4)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return img; // no card detected — leave untouched
  }

  const p = pad ?? Math.max(2, Math.round(Math.max(width, height) * 0.01));
  minX = Math.max(0, minX - p);
  minY = Math.max(0, minY - p);
  maxX = Math.min(width - 1, maxX + p);
  maxY = Math.min(height - 1, maxY + p);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((minY + y) * width + (minX + x)) * 4;
      const di = (y * w + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }

  return { data: out, width: w, height: h };
}

/** Nearest-neighbor resample to an exact target size. Deterministic, no deps. */
export function resizeNearest(
  img: RawImage,
  targetW: number,
  targetH: number,
): RawImage {
  const { data, width, height } = img;
  if (width === targetW && height === targetH) return img;

  const out = new Uint8ClampedArray(targetW * targetH * 4);

  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / targetH));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / targetW));
      const si = (sy * width + sx) * 4;
      const di = (y * targetW + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }

  return { data: out, width: targetW, height: targetH };
}

/**
 * Crop both images to their card, resample to a shared size, and pixel-diff.
 * The single source of truth for the Phase 0 fidelity number, used by both the
 * studio UI and the CLI so they can't report different scores.
 */
export function registerAndDiff(
  canvas: RawImage,
  sim: RawImage,
  diff: (
    a: Uint8ClampedArray,
    b: Uint8ClampedArray,
    width: number,
    height: number,
  ) => { diffPixels: number; totalPixels: number; score: number },
): { diffPixels: number; totalPixels: number; score: number; width: number; height: number } {
  const a = cropToContent(canvas);
  const b = cropToContent(sim);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const ar = resizeNearest(a, width, height);
  const br = resizeNearest(b, width, height);
  return { ...diff(ar.data, br.data, width, height), width, height };
}
