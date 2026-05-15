# PDF to Markdown OCR — Obsidian Plugin

将 PDF、Word、Excel、图片一键转换为 Markdown 笔记。支持文本提取和 AI OCR（GLM-4V / MiniMax / Gemini 多模型）。

Convert PDF, Word, Excel, and images to Markdown notes with one click. Supports text extraction and AI-powered OCR with GLM-4V, MiniMax, and Gemini.

## 功能特点 / Features

| 功能 | 说明 |
|------|------|
| 📄 **PDF 转换** | 文字型 PDF 直接提取；扫描件自动渲染为图片后 OCR |
| 📝 **Word 转换** | `.docx` 文件提取为 Markdown，保留标题/加粗/列表层级 |
| 📊 **Excel 转换** | `.xlsx` 文件多工作表提取，单元格原样保留，自动建表 |
| 🖼️ **图片 OCR** | PNG / JPG / WEBP 支持，调用 AI 模型识别为 Markdown |
| 🤖 **多模型 OCR** | GLM-4V / MiniMax / Gemini 可选，自动 fallback |
| 🌐 **中英文界面** | 设置页一键切换语言 |

## 技术栈 / Tech Stack

| 层 | 技术 |
|---|------|
| 框架 | [Obsidian API](https://docs.obsidian.md) |
| 构建 | TypeScript + esbuild |
| PDF 解析 | [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) |
| Word 解析 | [mammoth.js](https://github.com/mwilliamson/mammoth.js) |
| Excel 解析 | [SheetJS](https://sheetjs.com) |
| OCR API | GLM-4V (智谱) / MiniMax / Gemini 2.5 Flash |

## 安装 / Installation

### 手动安装

1. 在 [Releases](https://github.com/solituder-12day/convertMD_obsidian/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 将三个文件放入 vault 的 `.obsidian/plugins/pdf-to-markdown-ocr/`
3. 打开 Obsidian → 设置 → 第三方插件 → 启用 **PDF to Markdown OCR**

### 从源码构建

```bash
git clone git@github.com:solituder-12day/convertMD_obsidian.git
cd convertMD_obsidian
npm install
npm run build
```

将生成的 `main.js` + `manifest.json` + `styles.css` 复制到 vault 插件的目录。

## 配置 / Settings

进入 Obsidian 设置 → **PDF to Markdown OCR** 配置页：

| 配置项 | 说明 | 获取地址 |
|--------|------|---------|
| **界面语言** | 中文 / English | — |
| **OCR 模型** | 自动 / GLM-4V / GLM-4V-Flash / MiniMax / Gemini | — |
| **GLM API Key** | 智谱 AI，文字识别精度高，首选 | [open.bigmodel.cn](https://open.bigmodel.cn) |
| **MiniMax API Key** | 备选模型 | [platform.minimax.com](https://platform.minimax.com) |
| **Gemini API Key** | 备选模型 | [aistudio.google.com](https://aistudio.google.com/apikey) |

至少填一个 Key 即可使用。填写多个 Key 时，「自动」模式会按 GLM → MiniMax → Gemini 依次尝试。

## 使用方法 / Usage

1. 按 `Ctrl+P`（Mac: `Cmd+P`）打开命令面板
2. 搜索并选择 **Convert to Markdown**
3. 在文件选择器中选择 PDF / Word / Excel / 图片文件
4. 插件自动在 vault 根目录生成同名 `.md` 文件

## 处理流程 / Pipeline

```
上传文件
  ├── PDF ─── 文字型 → pdfjs 直接提取
  │           扫描件 → 渲染为图片 → OCR
  ├── Word ─── mammoth 提取 HTML → 转为 Markdown
  ├── Excel ── SheetJS 读取 → 多工作表 → Markdown 表格
  └── 图片 ─── Base64 → GLM-4V / MiniMax / Gemini
                              ↓
                      输出 .md 文件到 vault
```

## 开发 / Development

```bash
npm run dev       # 监听模式，增量编译
npm run build     # 生产构建，输出 main.js
```

项目结构：

```
obsidian-plugin/
├── main.ts          # 入口：命令 + 设置 + OCR 引擎
├── manifest.json    # 插件元数据
├── styles.css       # 自定义样式
├── package.json     # 依赖
├── tsconfig.json    # TypeScript 配置
└── esbuild.config.mjs # 构建配置
```

## 许可 / License

MIT
