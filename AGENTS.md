# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that converts PDF, Word, Excel, and images to Markdown with AI-powered OCR. Uses a fallback chain of customizable OCR models (OpenAI-compatible or Gemini APIs).

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Build with inline sourcemaps (development)
npm run build        # Build minified with type checking (production)
```

## Architecture

**Entry point:** `main.ts` — single-file plugin containing all logic

**Build system:** `esbuild.config.mjs` — bundles TypeScript to `main.js` (CommonJS format). Key detail: embeds pdfjs-dist worker as base64 data URL at build time to avoid CDN fetch issues in Obsidian's Electron environment.

**Conversion pipeline:**

1. **PDF** (`processPdf`) — First attempts text extraction via pdfjs-dist. If extracted text < 100 chars, assumes scanned PDF and triggers OCR page-by-page with bounded concurrency (2 workers) to limit memory.
2. **Word** (`processDocx`) — Uses mammoth.js → converts HTML to Markdown via regex replacements.
3. **Excel** (`processXlsx`) — Uses SheetJS → converts each sheet to Markdown tables with date formatting for Excel serial numbers (40000-60000 range). Trims empty leading/trailing columns.
4. **Images** (`processImage`) — Encodes to base64 and sends to OCR API.

**OCR fallback chain:** Models are tried in configured order. If one fails, the next is attempted. Supports two protocols:
- **OpenAI-compatible** — standard `chat/completions` with image_url content type
- **Gemini** — `generateContent` endpoint with inlineData

**Settings UI:** Custom Obsidian `PluginSettingTab` (`PdfOcrSettingTab`) renders model cards with enable/disable toggle, reorder buttons, and editable fields (name, URL, key, model name, max tokens). Preset models can be added via dropdown.

**Polyfills:** `Map.prototype.getOrInsertComputed` polyfill for Chromium < 120 (Obsidian Electron versions).

## File Types Supported

PDF, DOCX, XLSX, PNG, JPG, JPEG, WEBP

## Version Compatibility

- `minAppVersion`: 1.5.0
- `isDesktopOnly`: true (requires Electron features like FileReader)

## Testing

Obsidian plugins are typically tested manually by loading into the app (`vault/.obsidian/plugins/ocr-convert-markdown/`). No automated tests in this repo.