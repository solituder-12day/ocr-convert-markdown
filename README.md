# OCR convert Markdown

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

- **PDF** — Extract text directly; scanned PDFs auto-OCR (4 concurrent pages)
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
cd convertMD_obsidian
npm install
npm run build
```

## Tech Stack

**TypeScript + esbuild** / **pdfjs-dist** / **mammoth.js** / **SheetJS**

## Author

AIXMF

## License

MIT
