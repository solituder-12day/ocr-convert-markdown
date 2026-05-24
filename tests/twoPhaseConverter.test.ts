import assert from "node:assert/strict";
import { readFile } from "fs/promises";
import {
  makeOcrPendingPlaceholder,
  replaceOcrPendingPlaceholder,
} from "../src/conversion/ocrPlaceholders";
import { convertDocxToMarkdownFirstPass } from "../src/converters/wordConverter";

const placeholder = makeOcrPendingPlaceholder({
  id: "pdf-page-3",
  source: "pdf",
  page: 3,
  reason: "image_or_scanned_page",
});

assert.equal(
  placeholder,
  '<!-- OCR_PENDING id="pdf-page-3" source="pdf" page="3" reason="image_or_scanned_page" -->',
  "OCR placeholders should use a stable HTML comment format"
);

assert.equal(
  replaceOcrPendingPlaceholder(`before\n${placeholder}\nafter`, "pdf-page-3", "OCR text"),
  "before\nOCR text\nafter",
  "OCR repair should replace only the matching placeholder"
);

async function main() {
  const withImage = await readFile("/Users/solituder/Downloads/加班申请表.docx");
  const firstPass = await convertDocxToMarkdownFirstPass(
    withImage.buffer.slice(withImage.byteOffset, withImage.byteOffset + withImage.byteLength)
  );

  assert.ok(firstPass.markdown.includes("OCR_PENDING"), "DOCX embedded images should be marked for second-stage OCR");
  assert.ok(firstPass.pendingImages.length > 0, "DOCX first pass should retain embedded image data for OCR repair");
  assert.match(firstPass.markdown, /\|\s*姓名\s*\|\s*卢志斌\s*\|/, "DOCX first pass should still preserve tables");

  console.log("two-phase converter tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
