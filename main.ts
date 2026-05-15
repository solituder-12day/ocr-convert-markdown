import {
  Plugin,
  Notice,
  Setting,
  PluginSettingTab,
  App,
  TFile,
  normalizePath,
  Menu,
} from "obsidian";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

// ─── Types ───────────────────────────────────────────────
interface OcrModelConfig {
  id: string;
  name: string;
  provider: "openai" | "gemini";
  apiUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens: number;
  enabled: boolean;
}

interface PdfOcrSettings {
  models: OcrModelConfig[];
  language: "zh" | "en";
  debugMode: boolean;
  outputDir: string;
}

// ─── Logger ──────────────────────────────────────────────
function log(level: "info" | "warn" | "error" | "debug", msg: string, data?: any) {
  const prefix = `[OCR convert Markdown]`;
  const ts = new Date().toLocaleTimeString();
  const line = `${ts} ${prefix} ${msg}`;
  switch (level) {
    case "info":  console.log(line, data !== undefined ? data : ""); break;
    case "warn":  console.warn(line, data !== undefined ? data : ""); break;
    case "error": console.error(line, data !== undefined ? data : ""); break;
    case "debug": console.debug(line, data !== undefined ? data : ""); break;
  }
}

const DEFAULT_MODELS: OcrModelConfig[] = [
  { id: "glm",       name: "GLM-4V (高精度)",       provider: "openai", apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",                                                                                        apiKey: "", modelName: "glm-4v",        maxTokens: 16384, enabled: true },
  { id: "glm-fast",  name: "GLM-4V-Flash (快速)",   provider: "openai", apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",                                                                                        apiKey: "", modelName: "glm-4v-flash",  maxTokens: 16384, enabled: true },
  { id: "minimax",   name: "MiniMax-VL",            provider: "openai", apiUrl: "https://api.minimax.chat/v1/chat/completions",                                                                                                 apiKey: "", modelName: "MiniMax-VL-01", maxTokens: 8192, enabled: true },
  { id: "gemini",    name: "Gemini 2.5 Flash",      provider: "gemini", apiUrl: "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent",                                                         apiKey: "", modelName: "gemini-2.5-flash", maxTokens: 8192, enabled: true },
];

const DEFAULT_SETTINGS: PdfOcrSettings = {
  models: DEFAULT_MODELS,
  language: "en",
  debugMode: false,
  outputDir: "",
};

const SUPPORTED_EXT = [".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp"];

const ST = {
  language: "界面语言",
  modelList: "OCR 模型列表",
  addModel: "添加模型",
  deleteModel: "删除",
  name: "名称",
  provider: "API 协议",
  apiUrl: "API 地址",
  apiKey: "API Key",
  modelName: "模型名",
  maxTokens: "Max Tokens",
  enabled: "启用",
  moveUp: "上移",
  moveDown: "下移",
  openai: "OpenAI 兼容",
  gemini: "Gemini",
};

const ST_EN: Record<string, string> = {
  language: "Language",
  modelList: "OCR Models",
  addModel: "Add Model",
  deleteModel: "Delete",
  name: "Name",
  provider: "API Protocol",
  apiUrl: "API URL",
  apiKey: "API Key",
  modelName: "Model Name",
  maxTokens: "Max Tokens",
  enabled: "Enabled",
  moveUp: "Move Up",
  moveDown: "Move Down",
  openai: "OpenAI Compatible",
  gemini: "Gemini",
};

const T: Record<string, Record<string, string>> = {
  zh: {
    convert: "转换为 Markdown",
    processing: "正在转换…",
    scanning: "检测到扫描件，正在 OCR 识别…",
    done: "转换完成，文件已创建",
    error: "转换失败",
    noKey: "请先在设置中配置 API Key 并启用至少一个模型",
    noFile: "请先打开或选中一个文件",
    unsupported: "不支持的文件格式（支持 PDF/DOCX/XLSX/PNG/JPG/WEBP）",
    ctxConvert: "转换为 Markdown",
    statusReady: "就绪",
    ...ST,
  },
  en: {
    convert: "Convert to Markdown",
    processing: "Converting…",
    scanning: "Scanned document detected, running OCR…",
    done: "Conversion complete, file created",
    error: "Conversion failed",
    noKey: "Configure an API Key and enable at least one model in settings",
    noFile: "Open or select a file first",
    unsupported: "Unsupported format (supported: PDF/DOCX/XLSX/PNG/JPG/WEBP)",
    ctxConvert: "Convert to Markdown",
    statusReady: "Ready",
    ...ST_EN,
  },
};

const SYSTEM_PROMPT = "提取图片中所有文字，保持原文排版。\\n\\n- 标题用 # ## 层级\\n- 列表用 - 或 *\\n- 表格用 | 格式，首行后加 |:---|\\n- 逐行输出，原文换行处换行\\n- 不添加解释，不编造内容";

// PDF.js: disable worker to avoid CDN fetch failures in Obsidian's Electron
// pdfjs-dist will be imported dynamically to avoid worker fetch issues
// see processPdf() below

// Polyfill Map.getOrInsertComputed for Chromium < 120 (Obsidian Electron)
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
}

// Injected by esbuild define at build time — contains the pdfjs worker as base64 data URL
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
        // Read file with FileReader for reliability in Electron
        const buf = await new Promise<ArrayBuffer>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as ArrayBuffer);
          reader.onerror = () => rej(new Error("Failed to read file"));
          reader.readAsArrayBuffer(file);
        });
        let markdown = "";
        if (ext === ".pdf") markdown = await this.processPdfBuf(buf, file.name, hasKey);
        else if (ext === ".docx") markdown = await this.processDocxBuf(buf);
        else if (ext === ".xlsx") markdown = await this.processXlsxBuf(buf);
        else markdown = await this.processImageBuf(buf, file.type);

        const outName = file.name.replace(/\.[^.]+$/, "") + ".md";
        const outDir = this.settings.outputDir || "";
        const outPath = normalizePath(outDir ? `${outDir}/${outName}` : outName);
        const existing = this.app.vault.getAbstractFileByPath(outPath);
        if (existing instanceof TFile) await this.app.vault.modify(existing, markdown);
        else await this.app.vault.create(outPath, markdown);

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
      const data = await this.app.vault.readBinary(file);
      const blob = new Blob([data]);
      const jsFile = new File([blob], file.name, { type: this.getMimeType(ext) });

      let markdown = "";
      const start = Date.now();
      if (ext === ".pdf") markdown = await this.processPdf(jsFile, activeModels.length > 0);
      else if (ext === ".docx") markdown = await this.processDocx(jsFile);
      else if (ext === ".xlsx") markdown = await this.processXlsx(jsFile);
      else markdown = await this.processImage(jsFile);
      this.log("info", `Converted in ${((Date.now() - start) / 1000).toFixed(1)}s, output length: ${markdown.length} chars`);

      const outName = file.basename + ".md";
      const outDir = this.settings.outputDir || "";
      const outPath = normalizePath(outDir ? `${outDir}/${outName}` : outName);
      const existing = this.app.vault.getAbstractFileByPath(outPath);
      if (existing instanceof TFile) {
        this.log("debug", `Overwriting existing file: ${outPath}`);
        await this.app.vault.modify(existing, markdown);
      } else {
        this.log("debug", `Creating new file: ${outPath}`);
        await this.app.vault.create(outPath, markdown);
      }

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

  getMimeType(ext: string): string {
    const map: Record<string, string> = {
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    };
    return map[ext] || "application/octet-stream";
  }

  // ─── PDF ─────────────────────────────────────────────
  async processPdf(file: File, hasKey: boolean): Promise<string> {
    const buffer = await file.arrayBuffer();
    const pdfjsLib = await import("pdfjs-dist");
    if (typeof PDFJS_WORKER_URL !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    }
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    this.log("info", `PDF: ${pdf.numPages} pages`);

    // Extract text from all pages (same as web pdfExtractText)
    const texts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const lineMap: Record<number, { x: number; text: string }[]> = {};
      for (const item of content.items) {
        const s = (item as any).str;
        if (!s || !s.trim()) continue;
        const t = (item as any).transform;
        const y = Math.round(t?.[5] || 0);
        const x = t?.[4] || 0;
        if (!lineMap[y]) lineMap[y] = [];
        lineMap[y].push({ x, text: s });
      }
      const lines = Object.entries(lineMap)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([_, items]) =>
          items.sort((a, b) => a.x - b.x).map((item) => item.text).join("")
        );
      if (lines.length > 0) texts.push(lines.join("\n"));
    }
    let result = texts.join("\n\n---\n\n");

    // Check total extracted text (same threshold as web: < 100 → scanned)
    const stripped = result.replace(/[#*\-\s\n]/g, "");
    if (stripped.length >= 100 || !hasKey) {
      return result || "[无文字内容]";
    }

    // Scanned PDF — render all pages, then OCR in parallel (match web)
    this.log("info", "Scanned PDF detected, rendering pages for OCR");
    const pageImages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvas, viewport: vp } as any).promise;
      pageImages.push(canvas.toDataURL("image/png").split(",")[1]);
    }
    // Parallel OCR (concurrency: 4)
    const concurrency = 4;
    const pageTexts: string[] = new Array(pageImages.length);
    let nextIdx = 0;
    const worker = async () => {
      while (nextIdx < pageImages.length) {
        const idx = nextIdx++;
        this.log("info", `OCR page ${idx + 1}/${pageImages.length}`);
        pageTexts[idx] = await this.ocr(pageImages[idx], "image/png");
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    result = pageTexts.join("\n\n---\n\n");
    return result || "[无法识别文字]";
  }

  // ─── Word ────────────────────────────────────────────
  async processDocx(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) throw new Error("Empty file");
    const result = await mammoth.convertToHtml({ arrayBuffer: new Uint8Array(buffer).buffer as ArrayBuffer });
    return result.value
      .replace(/<h1>/g, "# ").replace(/<\/h1>/g, "\n\n")
      .replace(/<h2>/g, "## ").replace(/<\/h2>/g, "\n\n")
      .replace(/<strong>/g, "**").replace(/<\/strong>/g, "**")
      .replace(/<li>/g, "- ").replace(/<\/li>/g, "\n")
      .replace(/<p>/g, "").replace(/<\/p>/g, "\n\n")
      .replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\n{3,}/g, "\n\n").trim();
  }

  // ─── Excel ───────────────────────────────────────────
  async processXlsx(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const lines: string[] = [];
    for (let s = 0; s < wb.SheetNames.length; s++) {
      const name = wb.SheetNames[s];
      const sheet = wb.Sheets[name];
      if (!sheet["!ref"]) continue;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const data: string[][] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[addr];
          let val = "";
          if (cell) {
            if (cell.t === "s") {
              val = String(cell.w ?? cell.v ?? "");
            } else if (cell.t === "n" && typeof cell.v === "number" && cell.v > 40000 && cell.v < 60000) {
              // Excel date serial number (40000-60000 ≈ 2009-2064)
              const d = XLSX.SSF.parse_date_code(cell.v);
              if (d) {
                const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
                val = `${d.y}/${d.m}/${d.d} ${pad(d.H)}:${pad(d.M)}:${pad(d.S)}`;
              } else {
                val = String(cell.w ?? cell.v ?? "");
              }
            } else {
              val = String(cell.w ?? cell.v ?? "");
            }
          }
          row.push(val);
        }
        data.push(row);
      }
      if (!data.length) continue;
      if (s > 0) lines.push("---");
      let maxCol = data[0].length - 1;
      while (maxCol > 0 && data.every((r: string[]) => r[maxCol] === "")) maxCol--;
      const trimmed = data.map((r: string[]) => r.slice(0, maxCol + 1));
      lines.push(`## 📊 ${name}`);
      const esc = (x: string) => String(x).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
      lines.push("| " + trimmed[0].map(esc).join(" | ") + " |");
      lines.push("|" + trimmed[0].map(() => ":---|").join(""));
      for (let r = 1; r < trimmed.length; r++) {
        const v = trimmed[r].map(esc);
        if (v.some((x: string) => x.trim())) lines.push("| " + v.join(" | ") + " |");
      }
    }
    return lines.join("\n");
  }

  // ─── Image / OCR ─────────────────────────────────────
  async processDocxBuf(buf: ArrayBuffer): Promise<string> {
    if (!buf || buf.byteLength === 0) throw new Error("Empty file");
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(buf) });
    return result.value
      .replace(/<h1>/g, "# ").replace(/<\/h1>/g, "\n\n")
      .replace(/<h2>/g, "## ").replace(/<\/h2>/g, "\n\n")
      .replace(/<strong>/g, "**").replace(/<\/strong>/g, "**")
      .replace(/<li>/g, "- ").replace(/<\/li>/g, "\n")
      .replace(/<p>/g, "").replace(/<\/p>/g, "\n\n")
      .replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\n{3,}/g, "\n\n").trim();
  }

  async processXlsxBuf(buf: ArrayBuffer): Promise<string> {
    if (!buf || buf.byteLength === 0) throw new Error("Empty file");
    const wb = XLSX.read(buf, { type: "array" });
    const lines: string[] = [];
    for (let s = 0; s < wb.SheetNames.length; s++) {
      const name = wb.SheetNames[s];
      const sheet = wb.Sheets[name];
      if (!sheet["!ref"]) continue;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const data: string[][] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[addr];
          let val = "";
          if (cell) {
            if (cell.t === "s") {
              val = String(cell.w ?? cell.v ?? "");
            } else if (cell.t === "n" && typeof cell.v === "number" && cell.v > 40000 && cell.v < 60000) {
              const d = XLSX.SSF.parse_date_code(cell.v);
              if (d) {
                const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
                val = `${d.y}/${d.m}/${d.d} ${pad(d.H)}:${pad(d.M)}:${pad(d.S)}`;
              } else {
                val = String(cell.w ?? cell.v ?? "");
              }
            } else {
              val = String(cell.w ?? cell.v ?? "");
            }
          }
          row.push(val);
        }
        data.push(row);
      }
      if (!data.length) continue;
      if (s > 0) lines.push("---");
      let maxCol = data[0].length - 1;
      while (maxCol > 0 && data.every((r: string[]) => r[maxCol] === "")) maxCol--;
      const trimmed = data.map((r: string[]) => r.slice(0, maxCol + 1));
      lines.push(`## 📊 ${name}`);
      const esc = (x: string) => String(x).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
      lines.push("| " + trimmed[0].map(esc).join(" | ") + " |");
      lines.push("|" + trimmed[0].map(() => ":---|").join(""));
      for (let r = 1; r < trimmed.length; r++) {
        const v = trimmed[r].map(esc);
        if (v.some((x: string) => x.trim())) lines.push("| " + v.join(" | ") + " |");
      }
    }
    return lines.join("\n");
  }

  async processPdfBuf(buf: ArrayBuffer, name: string, hasKey: boolean): Promise<string> {
    return this.processPdf(new File([buf], name, { type: "application/pdf" }), hasKey);
  }

  async processImageBuf(buf: ArrayBuffer, mime: string): Promise<string> {
    const blob = new Blob([buf], { type: mime });
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(",")[1];
        this.ocr(b64, mime).then(res).catch(rej);
      };
      reader.onerror = () => rej(new Error("Failed to encode image"));
      reader.readAsDataURL(blob);
    });
  }

  cleanOutput(text: string): string {
    return text
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/!\[\]\([^)]+\)/g, "")
      .replace(/<img[^>]*>/gi, "")
      .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async processImage(file: File): Promise<string> {
    const reader = new FileReader();
    const b64 = await new Promise<string>((resolve) => {
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(file);
    });
    return this.ocr(b64, file.type);
  }

  async ocrImage(b64: string, mime: string): Promise<string> {
    const models = this.settings.models.filter((m) => m.enabled && m.apiKey);
    this.log("info", `OCR start, ${models.length} models in chain`);
    if (this.settings.debugMode) {
      models.forEach((m, i) => this.log("debug", `  [${i+1}] ${m.name} (${m.provider}) → ${m.apiUrl}`));
    }
    let lastError: string = "";
    for (const model of models) {
      const start = Date.now();
      try {
        const result = await this.ocrViaModel(b64, mime, model);
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

  async ocr(b64: string, mime: string): Promise<string> {
    const raw = await this.ocrImage(b64, mime);
    return this.cleanOutput(raw);
  }

  async ocrViaModel(b64: string, mime: string, model: OcrModelConfig): Promise<string> {
    const b64Preview = b64.substring(0, 40) + "...";
    this.log("debug", `OCR request: ${model.name} (${model.provider}), image: ${b64Preview}`);

    if (model.provider === "gemini") {
      const url = `${model.apiUrl}?key=${encodeURIComponent(model.apiKey)}`;
      const body = {
        contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.1 },
      };
      this.log("debug", `Gemini request URL: ${model.apiUrl}`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
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
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          { type: "text", text: SYSTEM_PROMPT },
        ]},
      ],
      temperature: 0.1,
    };
    if (model.maxTokens > 0) payload.max_tokens = model.maxTokens;
    const body = JSON.stringify(payload);
    this.log("info", `OCR → ${model.name} | ${model.apiUrl} | model=${model.modelName} | maxTokens=${model.maxTokens}`);
    let res = await fetch(model.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` },
      body,
    });
    // If max_tokens causes 400, retry without it
    if (res.status === 400 && model.maxTokens > 0) {
      const { max_tokens, ...withoutMax } = payload;
      res = await fetch(model.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` },
        body: JSON.stringify(withoutMax),
      });
    }
    const d = await res.json();
    if (!res.ok) {
      const emsg = d?.error?.message || JSON.stringify(d);
      this.log("error", `OCR ← ${model.name} HTTP ${res.status}: ${emsg}`);
      throw new Error(`[${model.name}] ${emsg}`);
    }
    return d.choices?.[0]?.message?.content || "";
  }

  // ─── Settings ────────────────────────────────────────
  async loadSettings() {
    const data = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
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
      .setName("🐛 Debug Mode")
      .setDesc("Output detailed logs to DevTools console (Ctrl+Shift+I)")
      .addToggle((t) =>
        t.setValue(s.debugMode).onChange(async (v) => {
          s.debugMode = v;
          await this.plugin.saveSettings();
          if (v) log("info", "Debug mode enabled");
        })
      );

    new Setting(containerEl)
      .setName("📁 Output Directory")
      .setDesc("Where to save converted .md files (blank = vault root)")
      .addText((tx) => {
        tx.setPlaceholder("Vault root").setValue(s.outputDir).onChange(async (v) => {
          s.outputDir = v.trim();
          await this.plugin.saveSettings();
        });
        tx.inputEl.style.width = "100%";
        return tx;
      });

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
          placeholder: "sk-... or AIza...",
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

    // ── Add model button ──
    const addRow = containerEl.createDiv({
      attr: {
        style: "text-align:center;margin:1em 0 2em;",
      },
    });
    const addBtn = addRow.createEl("button", {
      text: `+ ${t("addModel")}`,
      attr: {
        style:
          "padding:0.5em 1.5em;border-radius:6px;border:1px dashed var(--background-modifier-border);" +
          "background:var(--background-secondary);cursor:pointer;color:var(--text-normal);font-size:0.9em;",
      },
    });
    addBtn.addEventListener("click", async () => {
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
      await this.plugin.saveSettings();
      this.display();
    });
  }
}
