export interface CanvasRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function detectContentRegions(canvas: HTMLCanvasElement): CanvasRegion[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) {
    return [{ x: 0, y: 0, width: canvas.width, height: canvas.height }];
  }

  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  const corners = [
    sample(0, 0),
    sample(width - 1, 0),
    sample(0, height - 1),
    sample(width - 1, height - 1),
  ];
  const bg = corners.sort((a, b) => a - b)[Math.floor(corners.length / 2)];
  const inkThreshold = 28;
  const rowInk = new Array<number>(height).fill(0);

  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (Math.abs(lum - bg) > inkThreshold) ink++;
    }
    rowInk[y] = ink / Math.ceil(width / 3);
  }

  const blankThreshold = 0.006;
  const minGap = Math.max(24, Math.floor(height * 0.018));
  const minRegionHeight = Math.max(80, Math.floor(height * 0.04));
  const bands: { start: number; end: number }[] = [];
  let inBand = false;
  let start = 0;
  let blankRun = 0;

  for (let y = 0; y < height; y++) {
    const blank = rowInk[y] < blankThreshold;
    if (!blank && !inBand) {
      inBand = true;
      start = y;
      blankRun = 0;
    } else if (inBand && blank) {
      blankRun++;
      if (blankRun >= minGap) {
        const end = y - blankRun;
        if (end - start + 1 >= minRegionHeight) bands.push({ start, end });
        inBand = false;
        blankRun = 0;
      }
    } else if (inBand) {
      blankRun = 0;
    }
  }

  if (inBand && height - 1 - start + 1 >= minRegionHeight) {
    bands.push({ start, end: height - 1 });
  }

  const regions = bands.map((band) => trimRegionX(data, width, height, bg, inkThreshold, band.start, band.end));
  const filtered = mergeCloseRegions(regions.filter((r) => r.width > 20 && r.height > 20), height);
  return filtered.length ? filtered : [{ x: 0, y: 0, width, height }];
}

function trimRegionX(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bg: number,
  threshold: number,
  y1: number,
  y2: number
): CanvasRegion {
  let minX = width - 1;
  let maxX = 0;
  for (let y = Math.max(0, y1); y <= Math.min(height - 1, y2); y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (Math.abs(lum - bg) > threshold) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }

  const pad = 24;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, y1 - pad);
  const right = Math.min(width, maxX + pad);
  const bottom = Math.min(height, y2 + pad);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function mergeCloseRegions(regions: CanvasRegion[], pageHeight: number): CanvasRegion[] {
  const sorted = [...regions].sort((a, b) => a.y - b.y);
  const merged: CanvasRegion[] = [];
  const maxGap = Math.max(18, Math.floor(pageHeight * 0.012));

  for (const region of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(region);
      continue;
    }

    const gap = region.y - (prev.y + prev.height);
    if (gap <= maxGap) {
      const x = Math.min(prev.x, region.x);
      const y = Math.min(prev.y, region.y);
      const right = Math.max(prev.x + prev.width, region.x + region.width);
      const bottom = Math.max(prev.y + prev.height, region.y + region.height);
      prev.x = x;
      prev.y = y;
      prev.width = right - x;
      prev.height = bottom - y;
    } else {
      merged.push(region);
    }
  }

  return merged;
}
