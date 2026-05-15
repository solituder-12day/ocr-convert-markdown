# OCR convert Markdown

Convert PDF, Word, Excel, and images to Markdown notes with one click. Supports text extraction and AI-powered OCR via customizable model list.

## Quick Start

1. Install and enable the plugin
2. Go to **Settings → OCR convert Markdown**
3. Enter at least one API Key and enable a model  
4. **Right-click** a file → **Convert to Markdown**

## Usage

| Method | Action |
|--------|--------|
| Right-click file | File explorer → "Convert to Markdown" |
| Command palette | `Ctrl+P` → "Convert to Markdown" |
| Ribbon icon | Click the icon in the left toolbar |

## Features

- **PDF** — Extract text directly; scanned PDFs auto-OCR
- **Word** — Preserves headings, bold, and lists
- **Excel** — Multi-sheet extraction as Markdown tables
- **Images** — PNG / JPG / WEBP → OCR to Markdown
- **Custom Models** — Add any OCR-capable API (OpenAI-compatible or Gemini)
- **Model Fallback** — Models tried in configured order; next on failure

## Configuration

### General

| Setting | Description |
|---------|-------------|
| Language | English / 中文 |

### OCR Models

Add any number of OCR models. Each model has:

| Field | Description |
|-------|-------------|
| Name | Display name |
| API Protocol | `OpenAI Compatible` or `Gemini` |
| API URL | Endpoint URL |
| API Key | Authentication key |
| Model Name | Model identifier sent to the API |
| Enabled | Include in OCR fallback chain |

Use the ↑↓ arrows to reorder. Models are tried top-to-bottom; on failure the next model is used.

**Pre-populated defaults:**

| Model | Protocol | API URL |
|-------|----------|---------|
| GLM-4V | OpenAI | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| GLM-4V-Flash | OpenAI | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| MiniMax | OpenAI | `https://api.minimax.chat/v1/chat/completions` |
| Gemini 2.5 Flash | Gemini | `.../models/gemini-2.5-flash:generateContent` |

## Installation

Download `main.js`, `manifest.json`, `styles.css` into `vault/.obsidian/plugins/ocr-convert-markdown/`.

```bash
git clone git@github.com:solituder-12day/convertMD_obsidian.git
cd convertMD_obsidian
npm install
npm run build
```

## Development

```bash
npm run dev       # Watch mode
npm run build     # Production build
```

## Tech Stack

**TypeScript + esbuild** / **pdfjs-dist** / **mammoth.js** / **SheetJS**

## License

MIT
