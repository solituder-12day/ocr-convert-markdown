# OCR convert Markdown — Obsidian Plugin

Convert PDF, Word, Excel, and images to Markdown notes. Supports text extraction and AI-powered OCR via customizable model list.

## Quick Start

1. Install and enable the plugin
2. Go to **Settings → OCR convert Markdown**
3. Enter at least one API Key and enable a model
4. Click the ribbon icon or use `Ctrl+P` → **Import external file**

## Usage

| Method | Action |
|--------|--------|
| Ribbon icon | Click 📂 → pick a file from computer |
| Right-click vault file | File explorer → "Convert to Markdown" |
| Command palette | `Ctrl+P` → "Convert to Markdown" or "Import external file" |

## Features

- **PDF** — Extract text directly; scanned PDFs auto-OCR (streaming page-by-page)
- **Word** — Preserves headings, bold, and lists
- **Excel** — Multi-sheet extraction as Markdown tables; dates auto-formatted
- **Images** — PNG / JPG / WEBP → OCR to Markdown
- **Custom Models** — Add any OCR-capable API (OpenAI-compatible or Gemini)
- **Model Fallback** — Models tried in configured order; next on failure

## Configuration

### General

| Setting | Description |
|---------|-------------|
| Language | English / 中文 |
| Debug Mode | Output detailed logs to DevTools console |
| Output Directory | Where to save converted .md files (blank = vault root) |

### OCR Models

Add any number of OCR models. Each model has:

| Field | Description |
|-------|-------------|
| Name | Display name |
| API Protocol | `OpenAI Compatible` or `Gemini` |
| API URL | Endpoint URL |
| API Key | Authentication key |
| Model Name | Model identifier sent to the API |
| Max Tokens | Max output tokens per request |
| Enabled | Include in OCR fallback chain |

Use the ↑↓ arrows to reorder. Models are tried top-to-bottom; on failure the next model is used.

**Pre-populated defaults:**

| Model | Protocol |
|-------|----------|
| GLM-4V | OpenAI |
| GLM-4V-Flash | OpenAI |
| MiniMax-VL | OpenAI |
| Gemini 2.5 Flash | Gemini |

## Installation

Download `main.js`, `manifest.json`, `styles.css` into `vault/.obsidian/plugins/ocr-convert-markdown/`.

```bash
git clone git@github.com:solituder-12day/ocr-convert-markdown.git
cd ocr-convert-markdown
npm install
npm run build
```

## Changelog

### v1.2.0 — Memory Optimization

Reduced runtime memory footprint across all conversion pipelines:

- **PDF** — `pdf.destroy()` in `finally` block releases document object and internal page cache after conversion; text extraction phase now calls `page.cleanup()` per page; OCR path clears `texts`/`result` before rendering; base64 strings set to `null` after use; `Uint8Array` copy prevents pdfjs from holding the original buffer
- **Excel** — Workbook sheet references deleted in `finally` block after conversion completes
- **Images** — Removed redundant Blob + FileReader pipeline; base64 encoding now uses `Buffer.from().toString("base64")` directly, eliminating 2 intermediate copies
- **General** — Source `ArrayBuffer` from `vault.readBinary()` / `FileReader` is set to `null` immediately after conversion completes, allowing earlier GC; `onunload` cleanup via `register()` releases plugin-level references

### v1.1.0 — Dynamic Models & Parallel OCR

- Dynamic OCR model list with enable/disable, reorder, and preset models
- Parallel OCR for scanned PDFs with bounded concurrency (2 workers)
- External file import via ribbon icon
- Excel date formatting for serial numbers
- Bilingual UI (English / 中文)

### v1.0.0 — Initial Release

- PDF text extraction and OCR fallback
- Word (.docx) to Markdown
- Excel (.xlsx) to Markdown tables
- Image OCR
- OpenAI-compatible and Gemini API support

## Tech Stack

**TypeScript + esbuild** / **pdfjs-dist** / **mammoth.js** / **SheetJS**

## 作者

solituder-12day

## License

MIT
