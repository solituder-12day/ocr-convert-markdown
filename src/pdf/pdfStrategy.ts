import type { PdfTextQuality } from "../types";

export type PdfOcrMode = "speed" | "balanced" | "accuracy";
export type PdfPageMode = "text" | "ocr";

export interface PdfOcrSettingsLike {
  pdfOcrMode: PdfOcrMode;
  pdfOcrConcurrency: number;
  pdfOcrMaxPixels: number;
  pdfOcrHighPrecisionRetry: boolean;
}

export interface PdfPageModeInput {
  settings: PdfOcrSettingsLike;
  hasKey: boolean;
  textQuality: PdfTextQuality;
  strippedTextLength: number;
}

export function choosePdfPageMode(input: PdfPageModeInput): PdfPageMode {
  const { settings, hasKey, textQuality, strippedTextLength } = input;
  if (!hasKey) return "text";

  if (settings.pdfOcrMode === "accuracy") return "ocr";

  const hasUsableText = strippedTextLength >= 50;
  if (settings.pdfOcrMode === "speed") {
    return hasUsableText ? "text" : "ocr";
  }

  if (!hasUsableText) return "ocr";
  return textQuality.ok ? "text" : "ocr";
}

export function getPdfOcrScale(width: number, height: number, maxPixels: number): number {
  const targetWidth = 2600;
  const minScale = 2;
  const maxScale = 4;
  const targetScale = targetWidth / Math.max(width, 1);
  const pixelScale = Math.sqrt(Math.max(1, maxPixels) / Math.max(width * height, 1));
  return Math.max(1, Math.min(maxScale, Math.max(minScale, targetScale), pixelScale));
}

export function getPdfOcrConcurrency(settings: PdfOcrSettingsLike): number {
  return Math.max(1, Math.min(4, Math.floor(settings.pdfOcrConcurrency || 1)));
}

export function shouldChunkPdfCanvas(
  canvas: { width: number; height: number },
  settings: Pick<PdfOcrSettingsLike, "pdfOcrMaxPixels" | "pdfOcrMode">
): boolean {
  const pixels = canvas.width * canvas.height;
  const maxSingleImagePixels = Math.max(settings.pdfOcrMaxPixels * 1.25, 7_000_000);
  const veryTallPage = canvas.height / Math.max(canvas.width, 1) > 3.2;
  return pixels > maxSingleImagePixels || veryTallPage;
}

export function shouldRetryOcrWithPng(
  quality: { ok: boolean },
  settings: Pick<PdfOcrSettingsLike, "pdfOcrHighPrecisionRetry">
): boolean {
  return settings.pdfOcrHighPrecisionRetry && !quality.ok;
}

export function shouldUseStructuredRetry(
  text: string,
  settings: Pick<PdfOcrSettingsLike, "pdfOcrHighPrecisionRetry" | "pdfOcrMode">
): boolean {
  return settings.pdfOcrHighPrecisionRetry && settings.pdfOcrMode !== "speed" && needsStructuredPdfRetry(text);
}

export function needsStructuredPdfRetry(text: string): boolean {
  const hasConfigLabels = /(旁挂|运营商|BS后台地址|后台地址)/.test(text);
  if (!hasConfigLabels) return false;

  const ipCount = (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).length;
  const longNumberCount = (text.match(/\b\d{3,}\b/g) || []).length;
  const weakValueLines = text.split("\n").filter((line) => {
    if (!/(旁挂|运营商|BS后台地址|后台地址)/.test(line)) return false;
    const value = line.split(/[:：]/).slice(1).join(":").trim();
    return value.length === 0 || !/[A-Za-z0-9]/.test(value);
  }).length;

  return weakValueLines > 0 || ipCount === 0 || longNumberCount < 2;
}

export function assessPdfTextQuality(text: string, itemCount: number): PdfTextQuality {
  const compact = text.replace(/\s/g, "");
  const placeholderChars = (text.match(/[\u0000�□■◆◇]{1}/g) || []).length;
  if (placeholderChars / Math.max(compact.length, 1) > 0.08) {
    return { ok: false, reason: "too many missing-glyph placeholders" };
  }
  if (compact.length < 50) return { ok: true };

  const contentChars = (compact.match(/[\p{L}\p{N}\p{Script=Han}]/gu) || []).length;
  const symbolChars = compact.length - contentChars;
  const isolatedDots = (text.match(/(^|[\s　])([.·。])(?=($|[\s　]))/gm) || []).length;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const shortFragmentLines = lines.filter((line) => {
    const normalized = line.replace(/\s/g, "");
    return normalized.length > 0 && normalized.length <= 2;
  }).length;
  const colonLines = lines.filter((line) => /[:：]/.test(line)).length;
  const weakColonLines = lines.filter((line) => {
    if (!/[:：]/.test(line)) return false;
    const afterColon = line.split(/[:：]/).slice(1).join(":").replace(/[\s.·。]/g, "");
    return afterColon.length <= 1;
  }).length;

  if (isolatedDots >= 8 && isolatedDots / Math.max(lines.length, 1) > 0.2) {
    return { ok: false, reason: "too many isolated dot placeholders" };
  }

  if (symbolChars / Math.max(compact.length, 1) > 0.45 && contentChars < 120) {
    return { ok: false, reason: "symbol-heavy extracted text" };
  }

  if (shortFragmentLines >= 8 && shortFragmentLines / Math.max(lines.length, 1) > 0.35) {
    return { ok: false, reason: "too many fragmented lines" };
  }

  if (colonLines >= 3 && weakColonLines / colonLines > 0.6 && itemCount > 30) {
    return { ok: false, reason: "form fields look incomplete" };
  }

  return { ok: true };
}
