import assert from "node:assert/strict";
import { readFile } from "fs/promises";
import { convertDocxToMarkdown } from "../src/converters/wordConverter";

const file = "/Users/solituder/Downloads/加班申请表.docx";

async function main() {
  const buffer = await readFile(file);
  const markdown = await convertDocxToMarkdown(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  assert.match(markdown, /\|\s*姓名\s*\|\s*卢志斌\s*\|/, "DOCX tables should be preserved as Markdown tables");
  assert.match(markdown, /\|\s*:---\s*\|/, "DOCX tables should include Markdown separator rows");
  assert.ok(markdown.includes("天津传媒学院"), "table cell text should be preserved");

  console.log("word fixture tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
