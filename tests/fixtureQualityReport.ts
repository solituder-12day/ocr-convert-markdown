import { readFile, readdir } from "fs/promises";
import { basename, extname, join } from "path";
import { assessPdfTextQuality, choosePdfPageMode } from "../src/pdf/pdfStrategy";
import { convertDocxToMarkdownFirstPass } from "../src/converters/wordConverter";

const pdfDir = "/Users/solituder/Obsidian/solituder-12day/drcom/项目--PDF";
const docxDir = "/Users/solituder/Downloads";

interface TextItem {
  x: number;
  y: number;
  fontSize: number;
  text: string;
  width: number;
}

async function main() {
  const pdfFiles = (await readdir(pdfDir))
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .map((name) => join(pdfDir, name));
  const docxFiles = (await readdir(docxDir))
    .filter((name) => name.toLowerCase().endsWith(".docx"))
    .map((name) => join(docxDir, name));

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfReports = [];
  const pdfStart = Date.now();

  for (const file of pdfFiles) {
    const started = Date.now();
    const data = new Uint8Array(await readFile(file));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    let textChars = 0;
    let ocrPages = 0;

    try {
      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        const content = await page.getTextContent();
        const items = collectTextItems(content.items);
        const text = reconstructPageText(items);
        const stripped = text.replace(/[#*\-\s\n]/g, "");
        const quality = assessPdfTextQuality(text, items.length);
        const mode = choosePdfPageMode({
          settings: {
            pdfOcrMode: "balanced",
            pdfOcrConcurrency: 2,
            pdfOcrMaxPixels: 8_000_000,
            pdfOcrHighPrecisionRetry: true,
          },
          hasKey: true,
          textQuality: quality,
          strippedTextLength: stripped.length,
        });
        if (mode === "ocr") ocrPages++;
        textChars += stripped.length;
        pages.push({ page: i + 1, chars: stripped.length, items: items.length, mode, reason: quality.reason ?? "" });
        (page as any).cleanup?.();
      }
    } finally {
      pdf.destroy();
    }

    pdfReports.push({
      file: basename(file),
      pages: pdf.numPages,
      textChars,
      ocrPages,
      elapsedMs: Date.now() - started,
      samplePages: pages.slice(0, 3),
    });
  }

  const docxReports = [];
  const docxStart = Date.now();
  for (const file of docxFiles) {
    const started = Date.now();
    const buffer = await readFile(file);
    const firstPass = await convertDocxToMarkdownFirstPass(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    const markdown = firstPass.markdown;
    docxReports.push({
      file: basename(file),
      chars: markdown.length,
      lines: markdown.split("\n").length,
      headings: (markdown.match(/^#/gm) || []).length,
      pendingImages: firstPass.pendingImages.length,
      elapsedMs: Date.now() - started,
      preview: markdown.slice(0, 120).replace(/\n/g, "\\n"),
    });
  }

  console.log(JSON.stringify({
    pdfSummary: {
      files: pdfReports.length,
      totalPages: pdfReports.reduce((sum, item) => sum + item.pages, 0),
      totalOcrPagesBalanced: pdfReports.reduce((sum, item) => sum + item.ocrPages, 0),
      elapsedMs: Date.now() - pdfStart,
    },
    pdfReports,
    docxSummary: {
      files: docxReports.length,
      elapsedMs: Date.now() - docxStart,
    },
    docxReports,
  }, null, 2));
}

function collectTextItems(rawItems: any[]): TextItem[] {
  const items: TextItem[] = [];
  for (const item of rawItems) {
    const s = item.str;
    if (s === undefined || s === null) continue;
    const t = item.transform;
    items.push({
      x: t?.[4] || 0,
      y: t?.[5] || 0,
      fontSize: Math.abs(t?.[0] || t?.[3] || 12),
      text: s,
      width: item.width || 0,
    });
  }
  return items;
}

function reconstructPageText(items: TextItem[]): string {
  if (!items.length) return "";
  const sortedByY = [...items].sort((a, b) => b.y - a.y);
  const lineGroups: { y: number; items: TextItem[] }[] = [];
  for (const item of sortedByY) {
    const match = lineGroups.find((group) => Math.abs(group.y - item.y) <= 3);
    if (match) {
      match.items.push(item);
      match.y = match.items.reduce((sum, it) => sum + it.y, 0) / match.items.length;
    } else {
      lineGroups.push({ y: item.y, items: [item] });
    }
  }

  return lineGroups
    .sort((a, b) => b.y - a.y)
    .map((group) => group.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(""))
    .join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
