import assert from "node:assert/strict";
import { buildLocalConverterCommand, chooseLocalConverter, parseCommandTemplate } from "../src/local/localConverter";
import type { PdfOcrSettings } from "../src/types";

const baseSettings: Pick<PdfOcrSettings, "localConverterMode" | "localConverterCommand"> = {
  localConverterMode: "auto",
  localConverterCommand: "",
};

assert.equal(
  chooseLocalConverter(baseSettings, ".pdf", new Set(["docling", "marker_single"])),
  "docling",
  "auto mode should prefer Docling when available"
);

assert.equal(
  chooseLocalConverter(baseSettings, ".pdf", new Set(["marker_single"])),
  "marker",
  "auto mode should fall back to Marker for PDFs"
);

assert.equal(
  chooseLocalConverter(baseSettings, ".docx", new Set(["marker_single"])),
  null,
  "Marker should not be selected for Office documents"
);

assert.deepEqual(
  buildLocalConverterCommand("docling", "/in/a.pdf", "/tmp/out", ""),
  { command: "docling", args: ["/in/a.pdf", "--to", "md", "--output", "/tmp/out"] },
  "Docling command should export Markdown to a known output directory"
);

assert.deepEqual(
  buildLocalConverterCommand("marker", "/in/a.pdf", "/tmp/out", ""),
  { command: "marker_single", args: ["/in/a.pdf", "--output_dir", "/tmp/out", "--output_format", "markdown"] },
  "Marker command should request Markdown output"
);

assert.deepEqual(
  parseCommandTemplate('mytool --input "{input}" --out "{output}"'),
  ["mytool", "--input", "{input}", "--out", "{output}"],
  "custom templates should preserve quoted placeholders"
);

assert.deepEqual(
  buildLocalConverterCommand("custom", "/in/a.pdf", "/tmp/out", 'mytool --input "{input}" --out "{output}"'),
  { command: "mytool", args: ["--input", "/in/a.pdf", "--out", "/tmp/out"] },
  "custom command templates should replace input and output placeholders"
);

console.log("localConverter tests passed");
