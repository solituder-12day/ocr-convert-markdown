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
import * as pdfjsLib from "pdfjs-dist";
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
  enabled: boolean;
}

interface PdfOcrSettings {
  models: OcrModelConfig[];
  language: "zh" | "en";
}

const DEFAULT_MODELS: OcrModelConfig[] = [
  { id: "glm",       name: "GLM-4V (高精度)",       provider: "openai", apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",         apiKey: "", modelName: "glm-4v",        enabled: true },
  { id: "glm-fast",  name: "GLM-4V-Flash (快速)",   provider: "openai", apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",         apiKey: "", modelName: "glm-4v-flash",  enabled: true },
  { id: "minimax",   name: "MiniMax",               provider: "openai", apiUrl: "https://api.minimax.chat/v1/chat/completions",                 apiKey: "", modelName: "MiniMax-Text-01", enabled: true },
  { id: "gemini",    name: "Gemini 2.5 Flash",      provider: "gemini", apiUrl: "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent", apiKey: "", modelName: "gemini-2.5-flash", enabled: true },
];

const DEFAULT_SETTINGS: PdfOcrSettings = {
  models: DEFAULT_MODELS,
  language: "zh",
};

const SUPPORTED_EXT = [".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp"];

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
    settings: {
      language: "界面语言",
      modelList: "OCR 模型列表",
      addModel: "添加模型",
      deleteModel: "删除",
      name: "名称",
      provider: "API 协议",
      apiUrl: "API 地址",
      apiKey: "API Key",
      modelName: "模型名",
      enabled: "启用",
      moveUp: "上移",
      moveDown: "下移",
      openai: "OpenAI 兼容",
      gemini: "Gemini",
    } as any,
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
    settings: {
      language: "Language",
      modelList: "OCR Models",
      addModel: "Add Model",
      deleteModel: "Delete",
      name: "Name",
      provider: "API Protocol",
      apiUrl: "API URL",
      apiKey: "API Key",
      modelName: "Model Name",
      enabled: "Enabled",
      moveUp: "Move Up",
      moveDown: "Move Down",
      openai: "OpenAI Compatible",
      gemini: "Gemini",
    } as any,
  },
};

const SYSTEM_PROMPT =
  "逐行提取图片文字，用 Markdown 反映原文结构。\n\n规则：\n1. 标题、列表、表格等按原文层级使用 Markdown（# ## * - | 等）。正文段落之间用空行分隔。\n2. 原文换行处必须换行。保留缩进和空格。\n3. 禁止翻译、修改、总结、补充任何文字。\n4. 禁止输出图片描述、路径、文件名。\n5. 只输出识别内容，不加前缀后缀。";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.7.284/pdf.worker.min.mjs";

// ─── Plugin ──────────────────────────────────────────────
export default class PdfOcrPlugin extends Plugin {
  settings!: PdfOcrSettings;
  statusBar!: HTMLElement;

  t(key: string): string {
    const lang = this.settings.language === "en" ? T.en : T.zh;
    const v = deepGet(lang, key.split("."));
    return typeof v === "string" ? v : key;
  }

  async onload() {
    await this.loadSettings();
    this.statusBar = this.addStatusBarItem();
    this.statusBar.setText(`📄 ${this.t("statusReady")}`);

    this.addRibbonIcon("document", this.t("convert"), () => this.convertActiveFile());

    this.addCommand({
      id: "convert-to-markdown",
      name: this.t("convert"),
      callback: () => this.convertActiveFile(),
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

  async convertFile(file: TFile) {
    const ext = file.extension ? "." + file.extension.toLowerCase() : "";
    if (!SUPPORTED_EXT.includes(ext)) { new Notice(this.t("unsupported")); return; }

    const activeModels = this.settings.models.filter((m) => m.enabled && m.apiKey);
    const noExt = ext === ".pdf" || ext === ".docx" || ext === ".xlsx";
    if (!noExt && activeModels.length === 0) { new Notice(this.t("noKey")); return; }

    this.statusBar.setText(`⏳ ${this.t("processing")}`);
    const notice = new Notice(`⏳ ${this.t("processing")}`, 0);

    try {
      const data = await this.app.vault.readBinary(file);
      const blob = new Blob([data]);
      const jsFile = new File([blob], file.name, { type: this.getMimeType(ext) });

      let markdown = "";
      if (ext === ".pdf") markdown = await this.processPdf(jsFile, activeModels.length > 0);
      else if (ext === ".docx") markdown = await this.processDocx(jsFile);
      else if (ext === ".xlsx") markdown = await this.processXlsx(jsFile);
      else markdown = await this.processImage(jsFile);

      const outName = file.basename + ".md";
      const outPath = normalizePath(outName);
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
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const texts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const lineMap: Record<number, { x: number; text: string }[]> = {};
      for (const item of content.items) {
        const s = (item as any).str;
        if (!s?.trim()) continue;
        const t = (item as any).transform;
        const y = Math.round(t?.[5] || 0);
        const x = t?.[4] || 0;
        if (!lineMap[y]) lineMap[y] = [];
        lineMap[y].push({ x, text: s });
      }
      const lines = Object.entries(lineMap)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([_, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.text).join(""));
      texts.push(lines.join("\n"));
    }
    const result = texts.join("\n\n---\n\n");
    const stripped = result.replace(/[#*\-\s\n]/g, "");
    if (stripped.length >= 100 || !hasKey) return result || "[无文字内容]";
    new Notice(this.t("scanning"));
    const pageTexts: string[] = [];
    const pages = Math.min(pdf.numPages, 10);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvas, viewport: vp }).promise;
      const b64 = canvas.toDataURL("image/png").split(",")[1];
      pageTexts.push(await this.ocrImage(b64, "image/png"));
    }
    return pageTexts.join("\n\n---\n\n") || result;
  }

  // ─── Word ────────────────────────────────────────────
  async processDocx(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
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
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (!data?.length) continue;
      if (s > 0) lines.push("---");
      let maxCol = data[0].length - 1;
      while (maxCol > 0 && data.every((r: any[]) => r[maxCol] === "")) maxCol--;
      const trimmed = data.map((r: any[]) => r.slice(0, maxCol + 1));
      lines.push(`## 📊 ${name}`);
      const esc = (s: string) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
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
  async processImage(file: File): Promise<string> {
    const reader = new FileReader();
    const b64 = await new Promise<string>((resolve) => {
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(file);
    });
    return this.ocrImage(b64, file.type);
  }

  async ocrImage(b64: string, mime: string): Promise<string> {
    const models = this.settings.models.filter((m) => m.enabled && m.apiKey);
    for (const model of models) {
      try {
        return await this.ocrViaModel(b64, mime, model);
      } catch (e) {
        console.warn(`Model "${model.name}" failed:`, e);
      }
    }
    throw new Error("All OCR models failed");
  }

  async ocrViaModel(b64: string, mime: string, model: OcrModelConfig): Promise<string> {
    if (model.provider === "gemini") {
      const url = `${model.apiUrl}?key=${encodeURIComponent(model.apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { temperature: 0.1 },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message || `HTTP ${res.status}`);
      return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    // OpenAI-compatible provider
    const res = await fetch(model.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify({
        model: model.modelName,
        messages: [
          { role: "user", content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            { type: "text", text: SYSTEM_PROMPT },
          ]},
        ],
        temperature: 0.1,
        max_tokens: 16384,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error?.message || `HTTP ${res.status}`);
    return d.choices?.[0]?.message?.content || "";
  }

  // ─── Settings ────────────────────────────────────────
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Settings tab ──────────────────────────────────────
function deepGet(obj: any, keys: string[]): any {
  return keys.reduce((acc, k) => (acc && typeof acc === "object" ? acc[k] : undefined), obj);
}

class PdfOcrSettingTab extends PluginSettingTab {
  plugin: PdfOcrPlugin;

  constructor(app: App, plugin: PdfOcrPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const t = (key: string) => this.plugin.t(key);

    containerEl.createEl("h2", { text: "OCR convert Markdown" });

    new Setting(containerEl)
      .setName(t("settings.language"))
      .addDropdown((d) =>
        d.addOption("zh", "中文").addOption("en", "English")
          .setValue(s.language)
          .onChange(async (v: string) => {
            s.language = v as "zh" | "en";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    containerEl.createEl("h3", { text: t("settings.modelList") });

    s.models.forEach((model, idx) => {
      const settingDesc = this.plugin.t(`settings.${model.provider === "openai" ? "openai" : "gemini"}`);
      const item = new Setting(containerEl)
        .setName(`${idx + 1}. ${model.name || "(unnamed)"}`)
        .setDesc(`${settingDesc} · ${model.modelName}`)
        .addButton((b) =>
          b.setIcon("chevron-up").setTooltip(t("settings.moveUp")).onClick(async () => {
            if (idx <= 0) return;
            [s.models[idx - 1], s.models[idx]] = [s.models[idx], s.models[idx - 1]];
            await this.plugin.saveSettings();
            this.display();
          })
        )
        .addButton((b) =>
          b.setIcon("chevron-down").setTooltip(t("settings.moveDown")).onClick(async () => {
            if (idx >= s.models.length - 1) return;
            [s.models[idx], s.models[idx + 1]] = [s.models[idx + 1], s.models[idx]];
            await this.plugin.saveSettings();
            this.display();
          })
        )
        .addButton((b) =>
          b.setIcon("trash").setTooltip(t("settings.deleteModel")).onClick(async () => {
            s.models.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
          })
        );

      // Collapsible detail fields
      const detail = containerEl.createDiv({ cls: "pdf-ocr-model-detail" });
      detail.style.cssText = "margin-left: 2em; margin-bottom: 1em; padding: 0.5em; border-left: 2px solid var(--background-modifier-border);";

      new Setting(detail)
        .setName(t("settings.name"))
        .addText((t) => t.setValue(model.name).onChange(async (v) => { model.name = v; await this.plugin.saveSettings(); }));

      new Setting(detail)
        .setName(t("settings.provider"))
        .addDropdown((d) => d.addOption("openai", t("settings.openai")).addOption("gemini", t("settings.gemini"))
          .setValue(model.provider).onChange(async (v) => { model.provider = v as any; await this.plugin.saveSettings(); this.display(); })
        );

      new Setting(detail)
        .setName(t("settings.apiUrl"))
        .addText((t) => t.setValue(model.apiUrl).onChange(async (v) => { model.apiUrl = v; await this.plugin.saveSettings(); }));

      new Setting(detail)
        .setName(t("settings.apiKey"))
        .addText((t) => t.setPlaceholder("sk-... or AIza...").setValue(model.apiKey).onChange(async (v) => { model.apiKey = v; await this.plugin.saveSettings(); }));

      new Setting(detail)
        .setName(t("settings.modelName"))
        .addText((t) => t.setValue(model.modelName).onChange(async (v) => { model.modelName = v; await this.plugin.saveSettings(); }));
    });

    // Add model button
    new Setting(containerEl).addButton((b) =>
      b.setButtonText(`+ ${t("settings.addModel")}`).onClick(async () => {
        s.models.push({
          id: "custom-" + Date.now(),
          name: "New Model",
          provider: "openai",
          apiUrl: "https://api.openai.com/v1/chat/completions",
          apiKey: "",
          modelName: "gpt-4o",
          enabled: true,
        });
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
}
