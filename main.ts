import {
  Plugin,
  Notice,
  Setting,
  PluginSettingTab,
  App,
  normalizePath,
  TFile,
} from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

// ─── Types ───────────────────────────────────────────────
interface PdfOcrSettings {
  glmApiKey: string;
  minimaxApiKey: string;
  geminiApiKey: string;
  selectedModel: "glm" | "glm-fast" | "minimax" | "gemini" | "auto";
  language: "zh" | "en";
}

const DEFAULT_SETTINGS: PdfOcrSettings = {
  glmApiKey: "",
  minimaxApiKey: "",
  geminiApiKey: "",
  selectedModel: "auto",
  language: "zh",
};

const T = {
  zh: {
    title: "PDF to Markdown OCR",
    noKey: "请先在设置中配置至少一个 API Key",
    convert: "转换为 Markdown",
    processing: "正在处理…",
    scanning: "检测到扫描件，正在 OCR 识别…",
    done: "转换完成",
    error: "转换失败",
    settings: {
      glmApiKey: "GLM API Key（智谱）",
      minimaxApiKey: "MiniMax API Key",
      geminiApiKey: "Gemini API Key",
      selectedModel: "OCR 模型",
      language: "界面语言",
    },
  },
  en: {
    title: "PDF to Markdown OCR",
    noKey: "Please configure at least one API Key in settings",
    convert: "Convert to Markdown",
    processing: "Processing…",
    scanning: "Scanned document detected, running OCR…",
    done: "Conversion complete",
    error: "Conversion failed",
    settings: {
      glmApiKey: "GLM API Key (Zhipu)",
      minimaxApiKey: "MiniMax API Key",
      geminiApiKey: "Gemini API Key",
      selectedModel: "OCR Model",
      language: "Language",
    },
  },
};

const SYSTEM_PROMPT =
  "逐行提取图片文字，用 Markdown 反映原文结构。\n\n规则：\n1. 标题、列表、表格等按原文层级使用 Markdown（# ## * - | 等）。正文段落之间用空行分隔。\n2. 原文换行处必须换行。保留缩进和空格。\n3. 禁止翻译、修改、总结、补充任何文字。\n4. 禁止输出图片描述、路径、文件名。\n5. 只输出识别内容，不加前缀后缀。";

const MODEL_OPTIONS: Record<string, string> = {
  auto: "自动 (Auto)",
  glm: "GLM-4V (高精度)",
  "glm-fast": "GLM-4V-Flash (快速)",
  minimax: "MiniMax",
  gemini: "Gemini 2.5 Flash",
};

// ─── Worker setup ────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.7.284/pdf.worker.min.mjs";

// ─── Plugin ──────────────────────────────────────────────
export default class PdfOcrPlugin extends Plugin {
  settings!: PdfOcrSettings;

  t(key: keyof typeof T.zh): any {
    const lang = this.settings.language === "en" ? T.en : T.zh;
    return lang[key];
  }

  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "convert-to-markdown",
      name: this.t("convert"),
      callback: () => this.convertFile(),
    });
    this.addSettingTab(new PdfOcrSettingTab(this.app, this));
    new Notice(`✅ ${this.t("title")} loaded`);
  }

  // ─── Core flow ───────────────────────────────────────
  async convertFile() {
    // Use Obsidian's file dialog
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp";
    input.multiple = false;
    input.click();

    const file = await new Promise<File | null>((resolve) => {
      const handler = () => {
        input.removeEventListener("change", handler);
        resolve(input.files?.[0] || null);
      };
      input.addEventListener("change", handler);
      setTimeout(() => resolve(null), 300_000); // 5min timeout
    });

    if (!file) {
      new Notice(this.t("noKey"));
      return;
    }

    const hasKey = !!(this.settings.glmApiKey || this.settings.minimaxApiKey || this.settings.geminiApiKey);
    const notice = new Notice(this.t("processing"), 0);

    try {
      let markdown = "";

      if (file.name.endsWith(".pdf")) {
        markdown = await this.processPdf(file, hasKey);
      } else if (file.name.endsWith(".docx")) {
        markdown = await this.processDocx(file);
      } else if (file.name.endsWith(".xlsx")) {
        markdown = await this.processXlsx(file);
      } else {
        // image
        if (!hasKey) throw new Error(this.t("noKey"));
        markdown = await this.processImage(file);
      }

      // Create note in vault root
      const base = file.name.replace(/\.[^.]+$/, "");
      const path = normalizePath(`${base}.md`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, markdown);
      } else {
        await this.app.vault.create(path, markdown);
      }

      notice.hide();
      new Notice(`✅ ${this.t("done")}: ${base}.md`);
    } catch (e: any) {
      notice.hide();
      new Notice(`❌ ${this.t("error")}: ${e.message}`);
      console.error(e);
    }
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
        .map(([_, items]) =>
          items
            .sort((a, b) => a.x - b.x)
            .map((i) => i.text)
            .join("")
        );
      texts.push(lines.join("\n"));
    }

    const result = texts.join("\n\n---\n\n");
    const stripped = result.replace(/[#*\-\s\n]/g, "");

    // If text-based PDF, return directly
    if (stripped.length >= 100 || !hasKey) {
      return result || "[无文字内容]";
    }

    // Scanned PDF — render pages to images and OCR
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

  // ─── Word ─────────────────────────────────────────────
  async processDocx(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    return result.value
      .replace(/<h1>/g, "# ")
      .replace(/<\/h1>/g, "\n\n")
      .replace(/<h2>/g, "## ")
      .replace(/<\/h2>/g, "\n\n")
      .replace(/<strong>/g, "**")
      .replace(/<\/strong>/g, "**")
      .replace(/<li>/g, "- ")
      .replace(/<\/li>/g, "\n")
      .replace(/<p>/g, "")
      .replace(/<\/p>/g, "\n\n")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ─── Excel ────────────────────────────────────────────
  async processXlsx(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const lines: string[] = [];
    for (let s = 0; s < wb.SheetNames.length; s++) {
      const name = wb.SheetNames[s];
      const sheet = wb.Sheets[name];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });
      if (!data?.length) continue;
      if (s > 0) lines.push("---");
      let maxCol = data[0].length - 1;
      while (maxCol > 0 && data.every((r: any[]) => r[maxCol] === "")) maxCol--;
      const trimmed = data.map((r: any[]) =>
        r.slice(0, maxCol + 1)
      );
      lines.push(`## 📊 ${name}`);
      const esc = (s: string) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
      lines.push("| " + trimmed[0].map(esc).join(" | ") + " |");
      lines.push("|" + trimmed[0].map(() => ":---|").join(""));
      for (let r = 1; r < trimmed.length; r++) {
        const v = trimmed[r].map(esc);
        if (v.some((x: string) => x.trim())) {
          lines.push("| " + v.join(" | ") + " |");
        }
      }
    }
    return lines.join("\n");
  }

  // ─── Image OCR ────────────────────────────────────────
  async processImage(file: File): Promise<string> {
    const reader = new FileReader();
    const b64 = await new Promise<string>((resolve) => {
      reader.onload = () =>
        resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(file);
    });
    return this.ocrImage(b64, file.type);
  }

  async ocrImage(b64: string, mime: string): Promise<string> {
    const model = this.settings.selectedModel;

    const ocrGLM = async (fast?: boolean) =>
      fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.glmApiKey}`,
        },
        body: JSON.stringify({
          model: fast ? "glm-4v-flash" : "glm-4v",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${b64}` },
                },
                { type: "text", text: SYSTEM_PROMPT },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 16384,
        }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error?.message);
        return d.choices?.[0]?.message?.content || "";
      });

    const ocrMiniMax = async () =>
      fetch("https://api.minimax.chat/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.minimaxApiKey}`,
        },
        body: JSON.stringify({
          model: "MiniMax-Text-01",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${b64}` },
                },
                { type: "text", text: SYSTEM_PROMPT },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 8192,
        }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error?.message);
        return d.choices?.[0]?.message?.content || "";
      });

    const ocrGemini = async () =>
      fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${this.settings.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { parts: [{ inlineData: { mimeType: mime, data: b64 } }] },
            ],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: { temperature: 0.1 },
          }),
        }
      ).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error?.message);
        return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      });

    if (model === "glm") return ocrGLM();
    if (model === "glm-fast") return ocrGLM(true);
    if (model === "minimax") return ocrMiniMax();
    if (model === "gemini") return ocrGemini();

    // auto fallback
    try {
      return await ocrGLM();
    } catch (e) {
      console.warn("GLM failed:", e);
    }
    try {
      return await ocrMiniMax();
    } catch (e) {
      console.warn("MiniMax failed:", e);
    }
    return ocrGemini();
  }

  // ─── Settings ────────────────────────────────────────
  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Settings Tab ──────────────────────────────────────
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
    const st = this.plugin.t("settings") as any;

    new Setting(containerEl)
      .setName(st.language)
      .addDropdown((d) =>
        d
          .addOption("zh", "中文")
          .addOption("en", "English")
          .setValue(s.language)
          .onChange(async (v: string) => {
            s.language = v as "zh" | "en";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(st.selectedModel)
      .addDropdown((d) => {
        for (const [k, v] of Object.entries(MODEL_OPTIONS)) {
          d.addOption(k, v);
        }
        d.setValue(s.selectedModel).onChange(async (v: string) => {
          s.selectedModel = v as PdfOcrSettings["selectedModel"];
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(st.glmApiKey)
      .setDesc("https://open.bigmodel.cn")
      .addText((t) =>
        t
          .setPlaceholder("your-glm-key")
          .setValue(s.glmApiKey)
          .onChange(async (v) => {
            s.glmApiKey = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(st.minimaxApiKey)
      .setDesc("https://platform.minimax.com")
      .addText((t) =>
        t
          .setPlaceholder("your-minimax-key")
          .setValue(s.minimaxApiKey)
          .onChange(async (v) => {
            s.minimaxApiKey = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(st.geminiApiKey)
      .setDesc("https://aistudio.google.com/apikey")
      .addText((t) =>
        t
          .setPlaceholder("your-gemini-key")
          .setValue(s.geminiApiKey)
          .onChange(async (v) => {
            s.geminiApiKey = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
