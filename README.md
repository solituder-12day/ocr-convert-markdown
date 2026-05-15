# PDF to Markdown OCR

将 PDF、Word、Excel、图片一键转换为 Markdown 笔记。支持文本提取和 AI OCR。

Convert PDF, Word, Excel, and images to Markdown notes. Supports text extraction and AI-powered OCR.

## 快速开始

1. 安装后启用插件
2. 打开「设置 → PDF to Markdown OCR」，填入至少一个 API Key
3. **右键** vault 中的 .pdf / .docx / .xlsx / .png / .jpg 文件 →「转换为 Markdown」
4. 自动在同目录生成 `.md` 文件

## 使用方式

| 方式 | 操作 |
|------|------|
| 右键文件 | 在文件管理器右键 →「转换为 Markdown」 |
| 命令面板 | `Ctrl+P` →「Convert to Markdown」（对当前打开的文件生效） |
| 工具栏按钮 | 点击左侧 ribbon 图标 → 对当前打开的文件生效 |

## 功能

- **PDF** — 文字型直接提取；扫描件自动 OCR
- **Word** — 保留标题/加粗/列表层级
- **Excel** — 多工作表原样转 Markdown 表格
- **图片** — PNG/JPG/WEBP → OCR 识别为 Markdown
- **多模型** — GLM-4V / MiniMax / Gemini，自动 fallback
- **中英文** — 设置页一键切换

## 配置

| 设置 | 说明 |
|------|------|
| 界面语言 | 中文 / English |
| OCR 模型 | 自动 / GLM-4V / MiniMax / Gemini |
| GLM API Key | [open.bigmodel.cn](https://open.bigmodel.cn) |
| MiniMax API Key | [platform.minimax.com](https://platform.minimax.com) |
| Gemini API Key | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

至少填一个 Key。填多个时「自动」模式会依次尝试。

## 安装

下载 `main.js`、`manifest.json`、`styles.css` 放入 `vault/.obsidian/plugins/pdf-to-markdown-ocr/` 目录。

```bash
git clone git@github.com:solituder-12day/convertMD_obsidian.git
cd convertMD_obsidian
npm install
npm run build
```

## 技术栈

**TypeScript + esbuild** / **pdfjs-dist** (PDF) / **mammoth.js** (Word) / **SheetJS** (Excel) / **GLM-4V · MiniMax · Gemini** (OCR)

## 许可

MIT
