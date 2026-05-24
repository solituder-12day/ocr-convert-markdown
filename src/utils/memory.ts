export function releaseCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

export async function waitForIdle() {
  await new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 250 });
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });
}

export async function pMap<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
