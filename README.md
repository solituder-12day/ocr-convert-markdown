# OCR convert Markdown

Convert PDF, Word, Excel, and images to Markdown notes with one click. Supports text extraction and AI-powered OCR (GLM-4V / MiniMax / Gemini).

## Quick Start

1. Install and enable the plugin
2. Go to **Settings → OCR convert Markdown**, enter at least one API Key
3. **Right-click** a .pdf / .docx / .xlsx / .png / .jpg file → **Convert to Markdown**
4. An `.md` file is created alongside the original

## Usage

| Method | Action |
|--------|--------|
| Right-click file | File explorer → "Convert to Markdown" |
| Command palette | `Ctrl+P` → "Convert to Markdown" (works on currently open file) |
| Ribbon icon | Click the icon in the left toolbar (works on currently open file) |

## Features

- **PDF** — Extract text directly; scanned PDFs auto-OCR
- **Word** — Preserves headings, bold, and list hierarchy
- **Excel** — Multi-sheet extraction rendered as Markdown tables
- **Images** — PNG / JPG / WEBP → OCR to Markdown
- **Multi-model OCR** — GLM-4V / MiniMax / Gemini with auto fallback
- **Bilingual UI** — English / Chinese toggle in settings

## Configuration

| Setting | Description |
|---------|-------------|
| Language | English / 中文 |
| OCR Model | Auto / GLM-4V / MiniMax / Gemini |
| GLM API Key | [open.bigmodel.cn](https://open.bigmodel.cn) |
| MiniMax API Key | [platform.minimax.com](https://platform.minimax.com) |
| Gemini API Key | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

At least one API Key is required. If multiple keys are configured, "Auto" mode tries GLM → MiniMax → Gemini in order.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` into `vault/.obsidian/plugins/ocr-convert-markdown/`.

### Build from source

```bash
git clone git@github.com:solituder-12day/convertMD_obsidian.git
cd convertMD_obsidian
npm install
npm run build
```

## Pipeline

```
Input file
  ├── PDF ─── Text-based → pdfjs extraction
  │           Scanned → render pages → OCR
  ├── Word ─── mammoth → HTML → Markdown
  ├── Excel ── SheetJS → multi-sheet → Markdown tables
  └── Image ── Base64 → GLM-4V / MiniMax / Gemini
                              ↓
                  Output .md to vault
```

## Development

```bash
npm run dev       # Watch mode
npm run build     # Production build
```

## Tech Stack

**TypeScript + esbuild** / **pdfjs-dist** (PDF) / **mammoth.js** (Word) / **SheetJS** (Excel) / **GLM-4V · MiniMax · Gemini** (OCR)

## License

MIT
