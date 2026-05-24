import {
  Plugin,
  Notice,
  Setting,
  PluginSettingTab,
  App,
  TFile,
  Menu,
  requestUrl,
} from "obsidian";
import { join } from "path";
import type { OcrModelConfig, OcrQuality, PdfOcrSettings } from "./src/types";
import { DEFAULT_SETTINGS, OCR_PRESETS, SUPPORTED_EXT } from "./src/settings/defaults";
import { T } from "./src/settings/i18n";
import { PDF_FORM_PROMPT, PDF_OCR_PROMPT, SYSTEM_PROMPT } from "./src/ocr/prompts";
import { log } from "./src/utils/logger";
import { pMap, releaseCanvas, waitForIdle } from "./src/utils/memory";
import { writeMarkdownFile as vaultWriteMarkdownFile } from "./src/obsidian/vaultIO";
import { convertDocxToMarkdownFirstPass } from "./src/converters/wordConverter";
import { convertXlsxToMarkdown } from "./src/converters/excelConverter";
import { detectContentRegions, type CanvasRegion } from "./src/image/regionDetector";
import { convertWithLocalEngine } from "./src/local/localConverter";
import { makeOcrPendingPlaceholder, replaceOcrPendingPlaceholder } from "./src/conversion/ocrPlaceholders";
import { stripOcrPreamble } from "./src/ocr/outputCleanup";
import {
  assessPdfTextQuality as assessPdfTextQualityForPage,
  choosePdfPageMode,
  getPdfOcrConcurrency,
  getPdfOcrScale,
  shouldChunkPdfCanvas,
  shouldRetryOcrWithPng,
  shouldUseStructuredRetry,
} from "./src/pdf/pdfStrategy";

// PDF.js: disable worker to avoid CDN fetch failures in Obsidian's Electron
// pdfjs-dist will be imported dynamically to avoid worker fetch issues
// see processPdf() below

// Polyfills for older Chromium builds used by Obsidian Electron.
{
  const P = Map.prototype as Record<string, any>;
  if (!P.getOrInsertComputed) {
    P.getOrInsertComputed = function (key: any, compute: () => any): any {
      if (this.has(key)) return this.get(key);
      const val = compute();
      this.set(key, val);
      return val;
    };
  }

  const M = Math as Record<string, any>;
  if (!M.sumPrecise) {
    M.sumPrecise = function (values: Iterable<number>): number {
      let sum = 0;
      for (const value of values) sum += value;
      return sum;
    };
  }
}

// PDF.js worker URL — injected by esbuild define at build time
declare const PDFJS_WORKER_URL: string;

// ─── Plugin ──────────────────────────────────────────────
export default class PdfOcrPlugin extends Plugin {
  settings!: PdfOcrSettings;
  statusBar!: HTMLElement;

  t(key: string): string {
    const lang = this.settings.language === "en" ? T.en : T.zh;
    return (lang as any)[key] || key;
  }

  log(level: "info" | "warn" | "error" | "debug", msg: string, data?: any) {
    if (level === "debug" && !this.settings.debugMode) return;
    log(level, msg, data);
  }

  async onload() {
    await this.loadSettings();
    this.log("info", "Plugin loaded");
    this.statusBar = this.addStatusBarItem();
    this.statusBar.setText(`📄 ${this.t("statusReady")}`);

    this.addRibbonIcon("folder-open", "Import file (convert Markdown)", () => this.importExternalFile());

    this.addCommand({
      id: "convert-to-markdown",
      name: this.t("convert"),
      callback: () => this.convertActiveFile(),
    });

    this.addCommand({
      id: "import-external-file",
      name: "Import external file",
      callback: () => this.importExternalFile(),
    });

    this.registerEvent(
      (this.app.workspace as any).on("file-menu", (menu: Menu, file: TFile) => {
        const ext = file.extension ? "." + file.extension.toLowerCase() : "";
        if (SUPPORTED_EXT.includes(ext)) {
          menu.addItem((item) => {
            item.setTitle(this.t("ctxConvert")).setIcon("document").onClick(() => this.convertFile(file));
          });
        }
      })
    );

    this.addSettingTab(new PdfOcrSettingTab(this.app, this));

    this.register(() => {
      this.statusBar = null as any;
    });
  }

  // ─── Core ───────────────────────────────────────────────
  getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  convertActiveFile() {
    const file = this.getActiveFile();
    if (!file) { new Notice(this.t("noFile")); return; }
    this.convertFile(file);
  }

  importExternalFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp";
    input.multiple = false;
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (!SUPPORTED_EXT.includes(ext)) {
        new Notice(this.t("unsupported"));
        return;
      }
      this.statusBar.setText(`⏳ ${this.t("processing")}`);
      const notice = new Notice(`⏳ ${this.t("processing")}`, 0);
      try {
        const hasKey = !!this.settings.models.filter((m) => m.enabled && m.apiKey).length;
        if (![".pdf", ".docx", ".xlsx"].includes(ext) && !hasKey) {
          notice.hide();
          this.statusBar.setText(`📄 ${this.t("statusReady")}`);
          new Notice(this.t("noKey"));
          return;
        }
        // Warn for large PDFs
        if (ext === ".pdf" && file.size > 10 * 1024 * 1024) {
          new Notice(`PDF file is large (${(file.size / 1024 / 1024).toFixed(1)}MB), processing may be slow`, 6000);
        }
        // Read file with FileReader for reliability in Electron
        let buf = await new Promise<ArrayBuffer>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as ArrayBuffer);
          reader.onerror = () => rej(new Error("Failed to read file"));
          reader.readAsArrayBuffer(file);
        });
        let markdown = "";
        if (ext === ".pdf") { markdown = await this.processPdf(buf, hasKey); buf = null as any; }
        else if (ext === ".docx") { markdown = await this.processDocx(buf, hasKey); buf = null as any; }
        else if (ext === ".xlsx") { markdown = await this.processXlsx(buf); buf = null as any; }
        else { markdown = await this.processImage(buf, file.type || this.getMimeType(ext)); buf = null as any; }

        const outName = file.name.replace(/\.[^.]+$/, "") + ".md";
        await this.writeMarkdownFile(outName, markdown);

        notice.hide();
        this.statusBar.setText(`✅ ${this.t("done")}`);
        new Notice(`✅ ${this.t("done")}: ${outName}`);
      } catch (e: any) {
        notice.hide();
        this.statusBar.setText(`❌ ${this.t("error")}`);
        new Notice(`❌ ${this.t("error")}: ${e.message}`);
      } finally {
        input.remove();
      }
    });
    input.click();
  }

  async convertFile(file: TFile) {
    const ext = file.extension ? "." + file.extension.toLowerCase() : "";
    this.log("info", `Convert: ${file.name} (${ext})`);
    if (!SUPPORTED_EXT.includes(ext)) {
      this.log("warn", `Unsupported format: ${ext}`);
      new Notice(this.t("unsupported"));
      return;
    }

    const activeModels = this.settings.models.filter((m) => m.enabled && m.apiKey);
    const noExt = ext === ".pdf" || ext === ".docx" || ext === ".xlsx";
    if (!noExt && activeModels.length === 0) {
      this.log("warn", "No active models with API keys configured");
      new Notice(this.t("noKey"));
      return;
    }
    this.log("info", `Active OCR models: ${activeModels.length}`);

    this.statusBar.setText(`⏳ ${this.t("processing")}`);
    const notice = new Notice(`⏳ ${this.t("processing")}`, 0);

    try {
      const localMarkdown = await this.tryLocalConversion(file, ext);
      if (localMarkdown !== null) {
        const outName = file.basename + ".md";
        await this.writeMarkdownFile(outName, localMarkdown);
        notice.hide();
        this.statusBar.setText(`✅ ${this.t("done")}`);
        new Notice(`✅ ${this.t("done")}: ${outName}`);
        return;
      }

      let data = await this.app.vault.readBinary(file);
      const hasKey = activeModels.length > 0;

      // Warn for large PDFs
      if (ext === ".pdf" && file.stat.size > 10 * 1024 * 1024) {
        new Notice(`PDF file is large (${(file.stat.size / 1024 / 1024).toFixed(1)}MB), processing may be slow`, 6000);
      }

      let markdown = "";
      const start = Date.now();
      if (ext === ".pdf") { markdown = await this.processPdf(data, hasKey); data = null as any; }
      else if (ext === ".docx") { markdown = await this.processDocx(data, hasKey); data = null as any; }
      else if (ext === ".xlsx") { markdown = await this.processXlsx(data); data = null as any; }
      else { markdown = await this.processImage(data, this.getMimeType(ext)); data = null as any; }
      this.log("info", `Converted in ${((Date.now() - start) / 1000).toFixed(1)}s, output length: ${markdown.length} chars`);

      const outName = file.basename + ".md";
      await this.writeMarkdownFile(outName, markdown);

      notice.hide();
      this.statusBar.setText(`✅ ${this.t("done")}`);
      new Notice(`✅ ${this.t("done")}: ${outName}`);
    } catch (e: any) {
      notice.hide();
      this.statusBar.setText(`❌ ${this.t("error")}`);
      this.log("error", `Conversion failed: ${e.message}`, e.stack);
      new Notice(`❌ ${this.t("error")}: ${e.message}`);
      console.error(e);
    }
  }

  async tryLocalConversion(file: TFile, ext: string): Promise<string | null> {
    if (this.settings.localConverterMode === "disabled") return null;

    const adapter = this.app.vault.adapter as any;
    const basePath = adapter.basePath;
    if (!basePath) return null;

    const inputPath = join(basePath, file.path);
    try {
      const result = await convertWithLocalEngine(
        inputPath,
        ext,
        this.settings,
        (msg) => this.log("debug", msg)
      );
      if (!result) return null;
      this.log("info", `Local converter succeeded: ${result.engine}`);
      return result.markdown;
    } catch (e: any) {
      this.log("warn", `Local converter failed, falling back: ${e.message}`);
      return null;
    }
  }

  getMimeType(ext: string): string {
    const map: Record<string, string> = {
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    };
    return map[ext] || "application/octet-stream";
  }

  async writeMarkdownFile(outName: string, markdown: string) {
    await vaultWriteMarkdownFile(
      this.app.vault,
      this.settings.outputDir,
      outName,
      markdown,
      (msg) => this.log("debug", msg)
    );
  }

  // ─── PDF ─────────────────────────────────────────────
  async processPdf(buffer: ArrayBuffer, hasKey: boolean): Promise<string> {
    const pdfData = new Uint8Array(buffer);
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    this.log("info", `PDF: ${pdf.numPages} pages`);

    try {
      const totalPages = pdf.numPages;

      // Phase 1: Extract text per page, identify scanned pages
      const pageResults: string[] = new Array(totalPages);
      const scannedPageIndices: number[] = [];
      const pendingPageIds = new Map<number, string>();

      if (hasKey && this.settings.pdfOcrMode === "accuracy") {
        this.log("info", "PDF accuracy mode; skipping embedded text layer");
        for (let i = 0; i < totalPages; i++) {
          this.markPdfPagePending(pageResults, pendingPageIds, scannedPageIndices, i, "accuracy_mode");
        }
      } else {
        for (let i = 0; i < totalPages; i++) {
          const page = await pdf.getPage(i + 1);
          const content = await page.getTextContent();

          // Collect text items with position and font size info
          interface TextItem { x: number; y: number; fontSize: number; text: string; width: number; }
          const items: TextItem[] = [];
          for (const item of content.items) {
            const s = (item as any).str;
            if (s === undefined || s === null) continue;
            const t = (item as any).transform;
            const fontSize = Math.abs(t?.[0] || t?.[3] || 12);
            const y = t?.[5] || 0;
            const x = t?.[4] || 0;
            const width = (item as any).width || 0;
            items.push({ x, y, fontSize, text: s, width });
          }

          if (items.length === 0) {
            this.markPdfPagePending(pageResults, pendingPageIds, scannedPageIndices, i, "image_or_scanned_page");
            (page as any).cleanup?.();
            continue;
          }

          // Tolerance-based Y grouping (merge items within 3px on Y axis)
          const Y_TOLERANCE = 3;
          const sortedByY = [...items].sort((a, b) => b.y - a.y);
          const lineGroups: { y: number; items: TextItem[] }[] = [];
          for (const item of sortedByY) {
            const match = lineGroups.find(g => Math.abs(g.y - item.y) <= Y_TOLERANCE);
            if (match) {
              match.items.push(item);
              // Update group Y to weighted average
              match.y = match.items.reduce((s, it) => s + it.y, 0) / match.items.length;
            } else {
              lineGroups.push({ y: item.y, items: [item] });
            }
          }

          // Detect median font size for heading classification
          const fontSizes = items.map(it => it.fontSize).sort((a, b) => a - b);
          const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 12;

          // Reconstruct lines with heading markers and inter-word spacing
          const lines = lineGroups
            .sort((a, b) => b.y - a.y)
            .map(group => {
              const sortedItems = group.items.sort((a, b) => a.x - b.x);
              // Detect gaps between items and insert spaces
              const parts: string[] = [];
              for (let j = 0; j < sortedItems.length; j++) {
                const cur = sortedItems[j];
                if (j > 0) {
                  const prev = sortedItems[j - 1];
                  const gap = cur.x - (prev.x + prev.width);
                  if (gap > prev.fontSize * 0.3) {
                    parts.push(" ");
                  }
                }
                parts.push(cur.text);
              }
              const lineText = parts.join("");
              const maxFontSize = Math.max(...sortedItems.map(it => it.fontSize));
              // Classify heading by font size ratio
              if (maxFontSize >= medianFontSize * 1.8) return `# ${lineText}`;
              if (maxFontSize >= medianFontSize * 1.4) return `## ${lineText}`;
              if (maxFontSize >= medianFontSize * 1.15) return `### ${lineText}`;
              return lineText;
            });

          const pageText = lines.join("\n");
          const stripped = pageText.replace(/[#*\-\s\n]/g, "");
          const textQuality = assessPdfTextQualityForPage(pageText, items.length);
          const pageMode = choosePdfPageMode({
            settings: this.settings,
            hasKey,
            textQuality,
            strippedTextLength: stripped.length,
          });

          if (pageMode === "ocr") {
            if (!textQuality.ok) this.log("warn", `PDF text layer low quality on page ${i + 1}: ${textQuality.reason}; using OCR`);
            else this.log("info", `PDF page ${i + 1}: using OCR (${this.settings.pdfOcrMode} mode)`);
            this.markPdfPagePending(pageResults, pendingPageIds, scannedPageIndices, i, textQuality.reason || "weak_text_layer");
            if (pageText.trim()) {
              pageResults[i] = `${this.cleanPdfTextLayerDraft(pageText)}\n\n${pageResults[i]}`;
            }
          } else {
            pageResults[i] = pageText;
          }
          (page as any).cleanup?.();
        }
      }

      // Phase 2: OCR scanned pages (hybrid mode — only pages that need it)
      if (hasKey && scannedPageIndices.length > 0) {
        this.log("info", `OCR ${scannedPageIndices.length} scanned pages: ${scannedPageIndices.map(i => i + 1).join(",")}`);

        const ocrConcurrency = getPdfOcrConcurrency(this.settings);
        const ocrResults = await pMap(scannedPageIndices, ocrConcurrency, async (idx, i) => {
          this.log("info", `Render + OCR page ${idx + 1}/${totalPages} (${i + 1}/${scannedPageIndices.length})`);
          const page = await pdf.getPage(idx + 1);
          const baseVp = page.getViewport({ scale: 1 });
          const scale = getPdfOcrScale(baseVp.width, baseVp.height, this.settings.pdfOcrMaxPixels);
          const vp = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);

          try {
            await page.render({ canvas, viewport: vp } as any).promise;
            const text = await this.ocrRenderedPdfPage(canvas, idx);
            return { idx, text };
          } finally {
            releaseCanvas(canvas);
            (page as any).cleanup?.();
            await waitForIdle();
          }
        });

        for (const { idx, text } of ocrResults) {
          const pendingId = pendingPageIds.get(idx);
          if (pendingId) {
            pageResults[idx] = replaceOcrPendingPlaceholder(pageResults[idx], pendingId, text);
          } else {
            pageResults[idx] = text;
          }
        }
      }

      return pageResults.filter(t => t).join("\n\n---\n\n") || "[无文字内容]";
    } finally {
      pdf.destroy();
    }
  }

  markPdfPagePending(
    pageResults: string[],
    pendingPageIds: Map<number, string>,
    scannedPageIndices: number[],
    pageIndex: number,
    reason: string
  ) {
    const id = `pdf-page-${pageIndex + 1}`;
    pendingPageIds.set(pageIndex, id);
    scannedPageIndices.push(pageIndex);
    pageResults[pageIndex] = makeOcrPendingPlaceholder({
      id,
      source: "pdf",
      page: pageIndex + 1,
      reason,
    });
  }

  cleanPdfTextLayerDraft(text: string): string {
    return text
      .replace(/\u0000+/g, "□")
      .replace(/[□]{4,}/g, "□□□")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async ocrRenderedPdfPage(canvas: HTMLCanvasElement, pageIndex: number): Promise<string> {
    if (!shouldChunkPdfCanvas(canvas, this.settings)) {
      this.log("info", `PDF page ${pageIndex + 1}: whole-page OCR`);
      let text = await this.ocrPdfCanvas(canvas, `page ${pageIndex + 1}`, true);

      if (shouldUseStructuredRetry(text, this.settings)) {
        this.log("warn", `Structured PDF retry for page ${pageIndex + 1}: missing key field values`);
        const retry = await this.ocrStructuredPdfPage(canvas);
        const currentScore = this.scoreConfigFields(text);
        const retryScore = this.scoreConfigFields(retry);
        this.log("info", `Structured retry score: current=${currentScore}, retry=${retryScore}`);
        if (retryScore > currentScore || (retryScore === currentScore && this.countOcrNoise(retry) < this.countOcrNoise(text))) {
          text = retry;
        }
      }

      return text;
    }

    const detectedRegions = detectContentRegions(canvas);
    const regions = this.expandRegionsIntoChunks(detectedRegions, canvas.width);
    const parts: string[] = [];

    this.log("info", `PDF page ${pageIndex + 1}: ${regions.length} OCR regions`);
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      const chunkCanvas = document.createElement("canvas");
      chunkCanvas.width = region.width;
      chunkCanvas.height = region.height;

      try {
        const ctx = chunkCanvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, chunkCanvas.width, chunkCanvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);

        this.log("info", `OCR page ${pageIndex + 1} region ${i + 1}/${regions.length}`);
        let text = await this.ocrPdfCanvas(chunkCanvas, `page ${pageIndex + 1} region ${i + 1}`, true);

        if (shouldUseStructuredRetry(text, this.settings)) {
          const structured = await this.ocrStructuredPdfPage(chunkCanvas);
          if (this.scoreConfigFields(structured) > this.scoreConfigFields(text)) text = structured;
        }

        parts.push(text);
      } finally {
        releaseCanvas(chunkCanvas);
        await waitForIdle();
      }
    }

    let text = this.mergeOcrParts(parts);
    if (shouldUseStructuredRetry(text, this.settings)) {
      this.log("warn", `Structured PDF retry for page ${pageIndex + 1}: missing key field values`);
      const retry = await this.ocrStructuredPdfPage(canvas);
      const currentScore = this.scoreConfigFields(text);
      const retryScore = this.scoreConfigFields(retry);
      this.log("info", `Structured retry score: current=${currentScore}, retry=${retryScore}`);
      if (retryScore > currentScore || (retryScore === currentScore && this.countOcrNoise(retry) < this.countOcrNoise(text))) {
        text = retry;
      }
    }

    return text;
  }

  async ocrPdfCanvas(canvas: HTMLCanvasElement, label: string, allowRetry: boolean): Promise<string> {
    let ocrCanvas: HTMLCanvasElement | null = null;
    let b64: string | null = null;

    try {
      ocrCanvas = this.prepareCanvasForOcr(canvas);
      b64 = ocrCanvas.toDataURL("image/png").split(",")[1];
      let text = this.cleanPdfOcrOutput(await this.ocrImage(b64, "image/png", PDF_OCR_PROMPT));
      const quality = this.assessOcrQuality(text, ocrCanvas);

      if (allowRetry && shouldRetryOcrWithPng(quality, this.settings)) {
        this.log("warn", `OCR quality retry ${label}: ${quality.reason}`);
        b64 = null;
        await waitForIdle();
        b64 = ocrCanvas.toDataURL("image/jpeg", 0.96).split(",")[1];
        text = this.cleanPdfOcrOutput(await this.ocrImage(b64, "image/jpeg", PDF_OCR_PROMPT));
        const retryQuality = this.assessOcrQuality(text, ocrCanvas);
        if (!retryQuality.ok) this.log("warn", `OCR retry still low quality: ${retryQuality.reason}`);
      }

      return text;
    } finally {
      b64 = null;
      if (ocrCanvas) releaseCanvas(ocrCanvas);
      await waitForIdle();
    }
  }

  expandRegionsIntoChunks(regions: CanvasRegion[], pageWidth: number): CanvasRegion[] {
    const expanded: CanvasRegion[] = [];
    for (const region of regions) {
      const chunkHeight = region.height <= 1900 ? region.height : 1600;
      const overlap = region.height <= 1900 ? 0 : 100;
      for (const chunk of this.getCanvasChunks(region.height, chunkHeight, overlap)) {
        expanded.push({
          x: Math.max(0, region.x),
          y: region.y + chunk.y,
          width: Math.min(pageWidth - region.x, region.width),
          height: chunk.height,
        });
      }
    }
    return expanded;
  }

  async ocrStructuredPdfPage(canvas: HTMLCanvasElement): Promise<string> {
    let ocrCanvas: HTMLCanvasElement | null = null;
    let b64: string | null = null;

    try {
      ocrCanvas = this.prepareCanvasForOcr(canvas);
      b64 = ocrCanvas.toDataURL("image/png").split(",")[1];
      return this.cleanPdfOcrOutput(await this.ocrImage(b64, "image/png", PDF_FORM_PROMPT));
    } finally {
      b64 = null;
      if (ocrCanvas) releaseCanvas(ocrCanvas);
      await waitForIdle();
    }
  }

  prepareCanvasForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    let total = 0;
    let dark = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      const lum = alpha === 0
        ? 255
        : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      total += lum;
      if (lum < 100) dark++;
    }

    const pixels = data.length / 4;
    const avg = total / Math.max(pixels, 1);
    const invert = avg < 135 || dark / Math.max(pixels, 1) > 0.45;
    const contrast = invert ? 1.7 : 1.35;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      let lum = alpha === 0
        ? 255
        : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (invert) lum = 255 - lum;
      let v = (lum - 128) * contrast + 128;
      v = Math.max(0, Math.min(255, v));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }

    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  assessOcrQuality(text: string, canvas: HTMLCanvasElement): OcrQuality {
    const compact = text.replace(/\s/g, "");
    if (compact.length === 0) return { ok: false, reason: "empty output" };

    const lower = text.toLowerCase();
    const refusalPatterns = [
      "无法识别",
      "看不清",
      "没有文字",
      "no text",
      "cannot read",
      "can't read",
      "unable to",
    ];
    if (refusalPatterns.some((p) => lower.includes(p))) {
      return { ok: false, reason: "model reported unreadable text" };
    }

    if (compact.length < 18 && canvas.width * canvas.height > 1_000_000) {
      return { ok: false, reason: "suspiciously short output" };
    }

    const replacementChars = (text.match(/[�□■◆◇?？]{2,}/g) || []).join("").length;
    if (replacementChars / Math.max(compact.length, 1) > 0.08) {
      return { ok: false, reason: "too many replacement characters" };
    }

    const noiseChars = (text.match(/[≈≠∠~_]{1}/g) || []).length;
    const punctuationNoise = (text.match(/[\\/]{1}/g) || []).length;
    if ((noiseChars + punctuationNoise) / Math.max(compact.length, 1) > 0.18) {
      return { ok: false, reason: "too many OCR noise symbols" };
    }

    const digits = (text.match(/\d/g) || []).length;
    const digitLikeMarks = (text.match(/[.,:;|/\\-]/g) || []).length;
    if (digitLikeMarks >= 20 && digits < 4) {
      return { ok: false, reason: "numeric-looking region lost digits" };
    }

    return { ok: true };
  }

  countUsefulChars(text: string): number {
    const ips = (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).join("").length;
    const longNumbers = (text.match(/\b\d{3,}\b/g) || []).join("").length;
    const content = (text.match(/[\p{L}\p{N}\p{Script=Han}@/>:.-]/gu) || []).length;
    return content + ips * 2 + longNumbers;
  }

  scoreConfigFields(text: string): number {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    let score = 0;

    for (const line of lines) {
      if (/旁挂/.test(line)) {
        score += 2;
        if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(line)) score += 8;
        if (/\b\d{3,}\b/.test(line)) score += 4;
      }
      if (/运营商/.test(line)) {
        score += 2;
        if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(line)) score += 8;
      }
      if (/BS后台地址|后台地址/.test(line)) {
        score += 2;
        if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(line)) score += 8;
      }
      if (/root\/drcom@admin\w+/i.test(line)) score += 6;
      if (/root\/drcomadmin\d+/i.test(line)) score += 6;
      if (/root\/drcom\d+/i.test(line)) score += 6;
      if (/ishare\/\d+\w*/i.test(line)) score += 6;
      if (/\b\d{3,}\/\d+\w*\b/.test(line)) score += 6;
    }

    score += Math.min(12, (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).length * 4);
    return score;
  }

  countOcrNoise(text: string): number {
    return (text.match(/[≈≠∠~_]{1}/g) || []).length + (text.match(/\/\/|\/\s+\/|[_~.·。]\s+[_~.·。]/g) || []).length * 2;
  }

  getCanvasChunks(totalHeight: number, maxHeight: number, overlap: number): { y: number; height: number }[] {
    if (totalHeight <= maxHeight) return [{ y: 0, height: totalHeight }];

    const chunks: { y: number; height: number }[] = [];
    let y = 0;
    const step = Math.max(1, maxHeight - overlap);

    while (y < totalHeight) {
      const remaining = totalHeight - y;
      const height = Math.min(maxHeight, remaining);
      chunks.push({ y, height });
      if (y + height >= totalHeight) break;
      y += step;
    }

    return chunks;
  }

  mergeOcrParts(parts: string[]): string {
    const merged: string[] = [];

    for (const part of parts) {
      const lines = part.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
      if (!lines.length) continue;

      let start = 0;
      const maxOverlap = Math.min(8, merged.length, lines.length);
      for (let n = maxOverlap; n > 0; n--) {
        const tail = merged.slice(-n).map((line) => line.trim()).join("\n");
        const head = lines.slice(0, n).map((line) => line.trim()).join("\n");
        if (tail && tail === head) {
          start = n;
          break;
        }
      }

      merged.push(...lines.slice(start));
    }

    return merged.join("\n").trim();
  }

  // ─── Word ────────────────────────────────────────────
  async processDocx(buffer: ArrayBuffer, hasKey = false): Promise<string> {
    const firstPass = await convertDocxToMarkdownFirstPass(buffer);
    if (!hasKey || firstPass.pendingImages.length === 0) return firstPass.markdown;

    let markdown = firstPass.markdown;
    const results = await pMap(firstPass.pendingImages, 1, async (image) => {
      this.log("info", `OCR DOCX embedded image: ${image.id}`);
      const text = this.cleanPdfOcrOutput(await this.ocrImage(image.base64, image.contentType, PDF_OCR_PROMPT));
      return { id: image.id, text };
    });

    for (const { id, text } of results) {
      markdown = replaceOcrPendingPlaceholder(markdown, id, text);
    }

    return markdown;
  }

  // ─── Excel ───────────────────────────────────────────
  async processXlsx(buffer: ArrayBuffer): Promise<string> {
    return convertXlsxToMarkdown(buffer);
  }

  // ─── Image / OCR ─────────────────────────────────────
  cleanOutput(text: string): string {
    const cleaned = text
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/!\[\]\([^)]+\)/g, "")
      .replace(/<img[^>]*>/gi, "")
      .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "")
      .replace(/\[.*?\]\(data:image\/[^)]+\)/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (this.isNonContentOcrMessage(cleaned)) return "";
    return this.removeOcrNoise(cleaned);
  }

  cleanPdfOcrOutput(text: string): string {
    const cleaned = text
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/!\[\]\([^)]+\)/g, "")
      .replace(/<img[^>]*>/gi, "")
      .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "")
      .replace(/\[.*?\]\(data:image\/[^)]+\)/gi, "")
      .replace(/```(?:markdown|md|text)?\n?/gi, "")
      .replace(/```/g, "")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
    const withoutPreamble = stripOcrPreamble(cleaned);
    return this.isNonContentOcrMessage(withoutPreamble) ? "" : withoutPreamble;
  }

  removeOcrNoise(text: string): string {
    return text
      .split("\n")
      .map((line) => {
        let cleaned = line.trim();
        cleaned = cleaned.replace(/\s*([:：])\s*/g, "$1 ");
        cleaned = cleaned
          .split(/[\s　]+/)
          .map((token) => this.cleanOcrToken(token))
          .filter((token) => token.length > 0)
          .join(" ")
          .replace(/\s*([:：])\s*/g, "$1 ")
          .replace(/([:：])(?:[._~≈≠∠·。/\\-]+\s*)+$/g, "$1")
          .replace(/[\s　]{2,}/g, " ")
          .trim();

        const contentChars = (cleaned.match(/[\p{L}\p{N}\p{Script=Han}]/gu) || []).length;
        const noiseChars = (cleaned.match(/[≈≠∠~_·。]{1}/g) || []).length;
        if (contentChars === 0 && noiseChars > 0) return "";
        return cleaned.trim();
      })
      .filter((line) => line.length > 0)
      .join("\n")
      .trim();
  }

  cleanOcrToken(token: string): string {
    let cleaned = token.trim();
    const hasContent = /[\p{L}\p{N}\p{Script=Han}]/u.test(cleaned);

    if (!hasContent) {
      return /^[._~≈≠∠·。/\\:：;\-,]+$/.test(cleaned) ? "" : cleaned;
    }

    cleaned = cleaned
      .replace(/[≈≠∠·。]+/g, "")
      .replace(/[_~]+(?=($|[^\p{L}\p{N}\p{Script=Han}]))/gu, "")
      .replace(/([@)>A-Za-z0-9\u4e00-\u9fff])[_~.\\-]+$/u, "$1")
      .replace(/^[_~≈≠∠·。/\\-]+/u, "")
      .replace(/[_~≈≠∠·。\\-]+$/u, "");

    return cleaned;
  }

  isNonContentOcrMessage(text: string): boolean {
    const normalized = text
      .replace(/^[#>*\-\s`"'“”‘’]+|[#>*\-\s`"'“”‘’。.!！]+$/g, "")
      .trim()
      .toLowerCase();

    if (!normalized) return true;
    if (normalized.length > 80) return false;

    const patterns = [
      /^(无法|不能|未能|没有|未发现|看不清|抱歉|对不起).*?(识别|读取|文字|文本|内容)/,
      /^(图片|图像|页面|该图片|这张图片).*?(没有|无|不包含|看不清).*?(文字|文本|内容)/,
      /^(no|there is no|there are no).*?(text|readable text|content)/,
      /^(unable|cannot|can't|could not).*?(read|recognize|extract|identify)/,
      /^sorry.*?(can't|cannot|unable).*?(read|recognize|extract)/,
    ];

    return patterns.some((pattern) => pattern.test(normalized));
  }

  async processImage(buffer: ArrayBuffer, mime: string): Promise<string> {
    let b64: string | null = Buffer.from(buffer).toString("base64");
    try {
      return await this.ocr(b64, mime);
    } finally {
      b64 = null;
      await waitForIdle();
    }
  }

  async ocrImage(b64: string, mime: string, prompt?: string): Promise<string> {
    const models = this.settings.models.filter((m) => m.enabled && m.apiKey);
    this.log("info", `OCR start, ${models.length} models in chain`);
    if (this.settings.debugMode) {
      models.forEach((m, i) => this.log("debug", `  [${i+1}] ${m.name} (${m.provider}) → ${m.apiUrl}`));
    }
    let lastError: string = "";
    for (const model of models) {
      const start = Date.now();
      try {
        const result = await this.ocrViaModel(b64, mime, model, prompt);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        this.log("info", `OCR succeeded: ${model.name} in ${elapsed}s (${result.length} chars)`);
        return result;
      } catch (e: any) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        lastError = e.message;
        this.log("warn", `OCR failed: ${model.name} in ${elapsed}s — ${e.message}`);
      }
    }
    this.log("error", `All OCR models failed. Last error: ${lastError}`);
    throw new Error(lastError || "All OCR models failed (no models configured)");
  }

  async ocr(b64: string, mime: string, prompt?: string): Promise<string> {
    const raw = await this.ocrImage(b64, mime, prompt);
    return this.cleanOutput(raw);
  }

  async ocrViaModel(b64: string, mime: string, model: OcrModelConfig, prompt?: string): Promise<string> {
    const b64Preview = b64.substring(0, 40) + "...";
    this.log("debug", `OCR request: ${model.name} (${model.provider}), image: ${b64Preview}`);

    const effectivePrompt = prompt || SYSTEM_PROMPT;

    if (model.provider === "gemini") {
      const apiUrl = this.resolveGeminiUrl(model);
      const separator = apiUrl.includes("?") ? "&" : "?";
      const url = `${apiUrl}${separator}key=${encodeURIComponent(model.apiKey)}`;
      const body: Record<string, any> = {
        contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }] }],
        systemInstruction: { parts: [{ text: effectivePrompt }] },
        generationConfig: { temperature: 0 },
      };
      if (model.maxTokens > 0) body.generationConfig.maxOutputTokens = model.maxTokens;
      this.log("debug", `Gemini request URL: ${apiUrl}`);
      const res = await requestUrl({
        url,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(body),
        throw: false,
      });
      const d = res.json;
      if (res.status < 200 || res.status >= 300) {
        const emsg = d.error?.message || JSON.stringify(d);
        this.log("error", `Gemini [${model.modelName}] HTTP ${res.status}: ${emsg}`);
        throw new Error(`[${model.name}] ${emsg}`);
      }
      return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    // OpenAI-compatible
    const payload: Record<string, any> = {
      model: model.modelName,
      messages: [
        { role: "user", content: [
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" } },
          { type: "text", text: effectivePrompt },
        ]},
      ],
      temperature: 0,
    };
    if (model.maxTokens > 0) payload.max_tokens = model.maxTokens;
    const body = JSON.stringify(payload);
    this.log("info", `OCR → ${model.name} | ${model.apiUrl} | model=${model.modelName} | maxTokens=${model.maxTokens}`);
    let res = await requestUrl({
      url: model.apiUrl,
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${model.apiKey}` },
      body,
      throw: false,
    });
    // If max_tokens causes 400, retry without it
    if (res.status === 400 && model.maxTokens > 0) {
      const { max_tokens, ...withoutMax } = payload;
      res = await requestUrl({
        url: model.apiUrl,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${model.apiKey}` },
        body: JSON.stringify(withoutMax),
        throw: false,
      });
    }
    const d = res.json;
    if (res.status < 200 || res.status >= 300) {
      const emsg = d?.error?.message || JSON.stringify(d);
      this.log("error", `OCR ← ${model.name} HTTP ${res.status}: ${emsg}`);
      throw new Error(`[${model.name}] ${emsg}`);
    }
    return d.choices?.[0]?.message?.content || "";
  }

  resolveGeminiUrl(model: OcrModelConfig): string {
    const apiUrl = model.apiUrl.trim();
    if (!model.modelName.trim()) return apiUrl;

    return apiUrl.replace(
      /\/models\/([^/:?]+):generateContent/,
      `/models/${encodeURIComponent(model.modelName.trim())}:generateContent`
    );
  }

  // ─── Settings ────────────────────────────────────────
  async loadSettings() {
    const data = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!["disabled", "auto", "docling", "marker", "custom"].includes(this.settings.localConverterMode)) {
      this.settings.localConverterMode = "auto";
    }
    if (typeof this.settings.localConverterCommand !== "string") {
      this.settings.localConverterCommand = "";
    }
    if (!["speed", "balanced", "accuracy"].includes(this.settings.pdfOcrMode)) {
      this.settings.pdfOcrMode = "balanced";
    }
    this.settings.pdfOcrConcurrency = Math.max(1, Math.min(4, Math.floor(this.settings.pdfOcrConcurrency || 2)));
    if (!Number.isFinite(this.settings.pdfOcrMaxPixels) || this.settings.pdfOcrMaxPixels < 1_000_000) {
      this.settings.pdfOcrMaxPixels = DEFAULT_SETTINGS.pdfOcrMaxPixels;
    }
    if (typeof this.settings.pdfOcrHighPrecisionRetry !== "boolean") {
      this.settings.pdfOcrHighPrecisionRetry = true;
    }
    if (typeof this.settings.preferPdfOcr !== "boolean") this.settings.preferPdfOcr = false;
    // Migration: add maxTokens to models that don't have it
    for (const m of this.settings.models) {
      if (typeof m.maxTokens !== "number") m.maxTokens = 8192;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Settings tab ──────────────────────────────────────
class PdfOcrSettingTab extends PluginSettingTab {
  plugin: PdfOcrPlugin;

  constructor(app: App, plugin: PdfOcrPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Helper: make input stretch full width
  stretchInput(inputEl: HTMLInputElement | HTMLTextAreaElement) {
    inputEl.style.width = "100%";
    inputEl.style.boxSizing = "border-box";
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const t = (key: string) => this.plugin.t(key);

    // Header
    const header = containerEl.createDiv({ cls: "ocr-header" });
    header.style.cssText =
      "text-align:center;padding:1.5em 0 1em;border-bottom:1px solid var(--background-modifier-border);margin-bottom:1.5em;";
    header.createEl("h2", { text: "OCR convert Markdown" });
    header.createEl("p", {
      text: "Convert PDF / Word / Excel / images to Markdown",
      attr: { style: "color:var(--text-muted);font-size:0.9em;margin-top:0.3em;" },
    });

    // ── General settings ──
    containerEl.createEl("h3", {
      text: "⚙️ " + t("language"),
      attr: { style: "margin-top:1.2em;" },
    });

    new Setting(containerEl)
      .setName(t("language"))
      .setDesc("Switch UI language")
      .addDropdown((d) =>
        d.addOption("zh", "中文").addOption("en", "English")
          .setValue(s.language)
          .onChange(async (v: string) => {
            s.language = v as "zh" | "en";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("🐛 " + t("debugMode"))
      .setDesc(t("debugModeDesc"))
      .addToggle((tl) =>
        tl.setValue(s.debugMode).onChange(async (v) => {
          s.debugMode = v;
          await this.plugin.saveSettings();
          if (v) log("info", "Debug mode enabled");
        })
      );

    new Setting(containerEl)
      .setName("🧩 " + t("localConverterMode"))
      .setDesc(t("localConverterModeDesc"))
      .addDropdown((d) =>
        d.addOption("auto", t("localConverterAuto"))
          .addOption("docling", t("localConverterDocling"))
          .addOption("marker", t("localConverterMarker"))
          .addOption("custom", t("localConverterCustom"))
          .addOption("disabled", t("localConverterDisabled"))
          .setValue(s.localConverterMode)
          .onChange(async (v: string) => {
            s.localConverterMode = v as PdfOcrSettings["localConverterMode"];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (s.localConverterMode === "custom") {
      const localCommandSetting = new Setting(containerEl)
        .setName("⌘ " + t("localConverterCommand"))
        .setDesc(t("localConverterCommandDesc"))
        .addText((tx) => {
          tx.setPlaceholder('mytool --input "{input}" --out "{output}"')
            .setValue(s.localConverterCommand)
            .onChange(async (v) => {
              s.localConverterCommand = v.trim();
              await this.plugin.saveSettings();
            });
          tx.inputEl.style.width = "100%";
          return tx;
        });
      localCommandSetting.settingEl.style.cssText = "flex-direction:column;align-items:stretch;";
      localCommandSetting.infoEl.style.cssText = "width:100%;";
      localCommandSetting.controlEl.style.cssText = "width:100%;justify-content:stretch;";
    }

    new Setting(containerEl)
      .setName("📄 " + t("pdfOcrMode"))
      .setDesc(t("pdfOcrModeDesc"))
      .addDropdown((d) =>
        d.addOption("speed", t("pdfOcrModeSpeed"))
          .addOption("balanced", t("pdfOcrModeBalanced"))
          .addOption("accuracy", t("pdfOcrModeAccuracy"))
          .setValue(s.pdfOcrMode)
          .onChange(async (v: string) => {
            s.pdfOcrMode = v as PdfOcrSettings["pdfOcrMode"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("⚡ " + t("pdfOcrConcurrency"))
      .setDesc(t("pdfOcrConcurrencyDesc"))
      .addSlider((sl) =>
        sl.setLimits(1, 4, 1)
          .setDynamicTooltip()
          .setValue(s.pdfOcrConcurrency)
          .onChange(async (v) => {
            s.pdfOcrConcurrency = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("🧠 " + t("pdfOcrMaxPixels"))
      .setDesc(t("pdfOcrMaxPixelsDesc"))
      .addText((tx) => {
        tx.setPlaceholder("8000000").setValue(String(s.pdfOcrMaxPixels)).onChange(async (v) => {
          const n = Number(v.trim());
          if (Number.isFinite(n) && n >= 1_000_000) {
            s.pdfOcrMaxPixels = Math.min(12_000_000, Math.floor(n));
            await this.plugin.saveSettings();
          }
        });
        tx.inputEl.type = "number";
        tx.inputEl.min = "1000000";
        tx.inputEl.max = "12000000";
        tx.inputEl.step = "500000";
        return tx;
      });

    new Setting(containerEl)
      .setName("🔁 " + t("pdfOcrHighPrecisionRetry"))
      .setDesc(t("pdfOcrHighPrecisionRetryDesc"))
      .addToggle((tl) =>
        tl.setValue(s.pdfOcrHighPrecisionRetry).onChange(async (v) => {
          s.pdfOcrHighPrecisionRetry = v;
          await this.plugin.saveSettings();
        })
      );

    const vaultRoot = (this.app.vault.adapter as any).basePath || this.app.vault.getRoot().path;
    const dirSetting = new Setting(containerEl)
      .setName("📁 " + t("outputDir"))
      .setDesc(t("outputDirDesc").replace(/\{vaultRoot\}/g, vaultRoot))
      .addText((tx) => {
        tx.setPlaceholder(vaultRoot).setValue(s.outputDir).onChange(async (v) => {
          s.outputDir = v.trim();
          await this.plugin.saveSettings();
        });
        tx.inputEl.style.width = "100%";
        return tx;
      });
    dirSetting.settingEl.style.cssText = "flex-direction:column;align-items:stretch;";
    dirSetting.infoEl.style.cssText = "width:100%;";
    dirSetting.controlEl.style.cssText = "width:100%;justify-content:stretch;";
    dirSetting.descEl.style.cssText = "font-size:0.85em;color:var(--text-muted);";

    // ── Model list ──
    containerEl.createEl("h3", {
      text: "🤖 " + t("modelList"),
      attr: { style: "margin-top:1.5em;" },
    });

    s.models.forEach((model, idx) => {
      const providerLabel = model.provider === "gemini" ? t("gemini") : t("openai");

      // ── Model card container ──
      const card = containerEl.createDiv({
        cls: "ocr-model-card",
        attr: {
          style:
            "border:1px solid var(--background-modifier-border);" +
            "border-radius:8px;margin-bottom:1em;overflow:hidden;",
        },
      });

      // Card header (name row + action buttons)
      const cardHeader = card.createDiv({
        attr: {
          style:
            "display:flex;align-items:center;justify-content:space-between;" +
            "padding:0.6em 1em;background:var(--background-secondary);" +
            "border-bottom:1px solid var(--background-modifier-border);",
        },
      });

      // Left side: toggle + name
      const leftGroup = cardHeader.createDiv({ attr: { style: "display:flex;align-items:center;gap:0.6em;" } });
      // Enable/disable toggle
      const toggleEl = leftGroup.createEl("input", { attr: { type: "checkbox" } });
      toggleEl.checked = model.enabled;
      toggleEl.style.cssText = "cursor:pointer;margin:0;";
      toggleEl.addEventListener("change", async () => {
        model.enabled = toggleEl.checked;
        await this.plugin.saveSettings();
      });

      leftGroup.createSpan({
        text: `${idx + 1}. ${model.name || "(unnamed)"}`,
        attr: {
          style: `font-weight:600;${model.enabled ? "" : "color:var(--text-muted);"}`,
        },
      });
      leftGroup.createSpan({
        text: providerLabel,
        attr: {
          style:
            "font-size:0.75em;background:var(--tag-bg);color:var(--tag-color);" +
            "padding:0.1em 0.5em;border-radius:4px;",
        },
      });
      leftGroup.createSpan({
        text: model.modelName,
        attr: {
          style:
            "font-size:0.75em;color:var(--text-muted);font-family:monospace;",
        },
      });

      // Right side: action buttons
      const rightGroup = cardHeader.createDiv({ attr: { style: "display:flex;gap:0.3em;" } });
      const makeBtn = (icon: string, tip: string, fn: () => void) => {
        const btn = rightGroup.createEl("button", {
          attr: {
            style:
              "background:none;border:none;cursor:pointer;padding:0.3em;border-radius:4px;" +
              "display:flex;align-items:center;justify-content:center;" +
              "color:var(--text-muted);font-size:1em;line-height:1;",
            title: tip,
          },
        });
        btn.innerHTML = icon;
        btn.addEventListener("click", fn);
        return btn;
      };
      makeBtn("▲", t("moveUp"), async () => {
        if (idx <= 0) return;
        [s.models[idx - 1], s.models[idx]] = [s.models[idx], s.models[idx - 1]];
        await this.plugin.saveSettings();
        this.display();
      });
      makeBtn("▼", t("moveDown"), async () => {
        if (idx >= s.models.length - 1) return;
        [s.models[idx], s.models[idx + 1]] = [s.models[idx + 1], s.models[idx]];
        await this.plugin.saveSettings();
        this.display();
      });
      makeBtn("✕", t("deleteModel"), async () => {
        s.models.splice(idx, 1);
        await this.plugin.saveSettings();
        this.display();
      });

      // ── Card body (detail fields) ──
      const body = card.createDiv({
        attr: { style: "padding:0.8em 1em 1em;" },
      });

      const makeSetting = (label: string, extraCss: string = "") => {
        const row = body.createDiv({
          attr: {
            style:
              "display:flex;align-items:flex-start;gap:0.6em;margin-bottom:0.6em;" +
              extraCss,
          },
        });
        row.createSpan({
          text: label,
          attr: {
            style:
              "min-width:6em;font-size:0.85em;color:var(--text-muted);" +
              "padding-top:0.4em;flex-shrink:0;",
          },
        });
        return row;
      };

      // Name
      const nameRow = makeSetting(t("name"));
      const nameInput = nameRow.createEl("input", {
        attr: {
          type: "text",
          value: model.name,
          style: "flex:1;padding:0.4em 0.6em;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);",
        },
      });
      nameInput.addEventListener("change", async () => {
        model.name = nameInput.value;
        await this.plugin.saveSettings();
      });

      // Provider
      const provRow = makeSetting(t("provider"));
      const provSelect = provRow.createEl("select", {
        attr: {
          style: "flex:1;padding:0.4em 0.6em;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);",
        },
      });
      provSelect.createEl("option", { value: "openai", text: t("openai") });
      provSelect.createEl("option", { value: "gemini", text: t("gemini") });
      provSelect.value = model.provider;
      provSelect.addEventListener("change", async () => {
        model.provider = provSelect.value as any;
        await this.plugin.saveSettings();
        this.display();
      });

      // API URL
      const urlRow = makeSetting(t("apiUrl"));
      const urlInput = urlRow.createEl("textarea", {
        attr: {
          rows: "2",
          style:
            "flex:1;padding:0.4em 0.6em;border-radius:4px;border:1px solid var(--background-modifier-border);" +
            "background:var(--background-primary);font-family:monospace;font-size:0.85em;resize:vertical;",
          placeholder: "https://api.example.com/v1/chat/completions",
        },
      });
      urlInput.value = model.apiUrl;
      urlInput.addEventListener("change", async () => {
        model.apiUrl = urlInput.value;
        await this.plugin.saveSettings();
      });

      // API Key
      const keyRow = makeSetting(t("apiKey"));
      const keyInput = keyRow.createEl("textarea", {
        attr: {
          rows: "1",
          style:
            "flex:1;padding:0.4em 0.6em;border-radius:4px;border:1px solid var(--background-modifier-border);" +
            "background:var(--background-primary);font-family:monospace;font-size:0.85em;resize:vertical;",
          placeholder: "Enter service credential",
        },
      });
      keyInput.value = model.apiKey;
      keyInput.addEventListener("change", async () => {
        model.apiKey = keyInput.value;
        await this.plugin.saveSettings();
      });

      // Model name
      const mdlRow = makeSetting(t("modelName"));
      const mdlInput = mdlRow.createEl("input", {
        attr: {
          type: "text",
          value: model.modelName,
          style: "flex:1;padding:0.4em 0.6em;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);font-family:monospace;",
        },
      });
      mdlInput.addEventListener("change", async () => {
        model.modelName = mdlInput.value;
        await this.plugin.saveSettings();
      });

      // Max Tokens
      const tokRow = makeSetting(t("maxTokens"));
      const tokInput = tokRow.createEl("input", {
        attr: {
          type: "number", min: "0", step: "1024",
          value: model.maxTokens.toString(),
          style: "flex:1;padding:0.4em 0.6em;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);max-width:8em;",
        },
      });
      tokInput.addEventListener("change", async () => {
        model.maxTokens = parseInt(tokInput.value) || 0;
        await this.plugin.saveSettings();
      });
    });

    // ── Add model button with preset selector ──
    const addRow = containerEl.createDiv({
      attr: { style: "text-align:center;margin:1em 0 2em;" },
    });

    // Preset selector
    const presetsDiv = addRow.createDiv({ attr: { style: "display:flex;gap:0.5em;justify-content:center;margin-bottom:0.5em;flex-wrap:wrap;" } });
    const presetSelect = presetsDiv.createEl("select", {
      attr: {
        style:
          "padding:0.4em 0.6em;border-radius:6px;border:1px solid var(--background-modifier-border);" +
          "background:var(--background-primary);color:var(--text-normal);font-size:0.85em;min-width:10em;",
      },
    });
    presetSelect.createEl("option", { value: "", text: "— Preset models —" });
    for (let i = 0; i < OCR_PRESETS.length; i++) {
      presetSelect.createEl("option", { value: String(i), text: OCR_PRESETS[i].name });
    }

    const addBtn = addRow.createEl("button", {
      text: `+ ${t("addModel")}`,
      attr: {
        style:
          "padding:0.5em 1.5em;border-radius:6px;border:1px dashed var(--background-modifier-border);" +
          "background:var(--background-secondary);cursor:pointer;color:var(--text-normal);font-size:0.9em;",
      },
    });
    addBtn.addEventListener("click", async () => {
      const idx = parseInt(presetSelect.value);
      if (!isNaN(idx) && OCR_PRESETS[idx]) {
        // Clone from preset
        s.models.push({ ...OCR_PRESETS[idx], id: "custom-" + Date.now() });
      } else {
        // Default blank
        s.models.push({
          id: "custom-" + Date.now(),
          name: "New Model",
          provider: "openai",
          apiUrl: "https://api.openai.com/v1/chat/completions",
          apiKey: "",
          modelName: "gpt-4o",
          maxTokens: 8192,
          enabled: true,
        });
      }
      await this.plugin.saveSettings();
      this.display();
    });
  }
}
