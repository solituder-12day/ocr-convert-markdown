import assert from "node:assert/strict";
import {
  assessPdfTextQuality,
  choosePdfPageMode,
  getPdfOcrScale,
  shouldChunkPdfCanvas,
  shouldRetryOcrWithPng,
  type PdfOcrSettingsLike,
} from "../src/pdf/pdfStrategy";

const balanced: PdfOcrSettingsLike = {
  pdfOcrMode: "balanced",
  pdfOcrConcurrency: 2,
  pdfOcrMaxPixels: 5_000_000,
  pdfOcrHighPrecisionRetry: true,
};

assert.equal(
  choosePdfPageMode({
    settings: balanced,
    hasKey: true,
    textQuality: { ok: true },
    strippedTextLength: 240,
  }),
  "text",
  "balanced mode should keep a good text layer instead of paying for OCR"
);

assert.equal(
  choosePdfPageMode({
    settings: balanced,
    hasKey: true,
    textQuality: { ok: false, reason: "form fields look incomplete" },
    strippedTextLength: 240,
  }),
  "ocr",
  "balanced mode should OCR pages whose text layer is structurally weak"
);

assert.equal(
  choosePdfPageMode({
    settings: { ...balanced, pdfOcrMode: "speed" },
    hasKey: true,
    textQuality: { ok: false, reason: "symbol-heavy extracted text" },
    strippedTextLength: 80,
  }),
  "text",
  "speed mode should avoid OCR when there is still usable extracted text"
);

assert.equal(
  choosePdfPageMode({
    settings: { ...balanced, pdfOcrMode: "accuracy" },
    hasKey: true,
    textQuality: { ok: true },
    strippedTextLength: 260,
  }),
  "ocr",
  "accuracy mode should force OCR when an OCR key is available"
);

assert.equal(
  shouldRetryOcrWithPng(
    { ok: false, reason: "suspiciously short output" },
    { ...balanced, pdfOcrHighPrecisionRetry: false }
  ),
  false,
  "high precision retry switch should disable extra OCR requests"
);

assert.ok(
  getPdfOcrScale(1200, 1600, 3_000_000) < getPdfOcrScale(1200, 1600, 9_000_000),
  "max pixel budget should lower render scale to save memory"
);

assert.equal(
  shouldChunkPdfCanvas({ width: 1800, height: 2400 }, balanced),
  false,
  "normal PDF pages should OCR as one image to preserve reading order and reduce API calls"
);

assert.equal(
  shouldChunkPdfCanvas({ width: 1800, height: 7200 }, balanced),
  true,
  "very tall rendered pages should still be chunked to control memory and model input size"
);

assert.deepEqual(
  assessPdfTextQuality("姓名: 张三\n电话: 13800138000\n地址: 上海市\n", 12),
  { ok: true },
  "quality helper remains importable and accepts normal text"
);

assert.equal(
  assessPdfTextQuality("旁挂\u0000\u0000\u0000\u0000：\u0000\u0000\u0000.\u0000\u0000.0.0\nroot/drcom@admin.\u0000\u0000\u0000", 20).ok,
  false,
  "PDF text layers with NUL placeholders should be treated as incomplete"
);

console.log("pdfStrategy tests passed");
