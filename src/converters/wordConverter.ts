import mammoth from "mammoth";
import { makeOcrPendingPlaceholder } from "../conversion/ocrPlaceholders";

export interface PendingDocxImage {
  id: string;
  contentType: string;
  base64: string;
}

export interface DocxFirstPassResult {
  markdown: string;
  pendingImages: PendingDocxImage[];
}

export async function convertDocxToMarkdown(buffer: ArrayBuffer): Promise<string> {
  return (await convertDocxToMarkdownFirstPass(buffer)).markdown;
}

export async function convertDocxToMarkdownFirstPass(buffer: ArrayBuffer): Promise<DocxFirstPassResult> {
  if (!buffer || buffer.byteLength === 0) throw new Error("Empty file");
  const pendingImages: PendingDocxImage[] = [];
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(buffer) },
    {
      convertImage: (mammoth as any).images.imgElement(async (image: any) => {
        const imageBuffer = await image.read();
        const id = `docx-image-${pendingImages.length + 1}`;
        const contentType = image.contentType || "image/png";
        pendingImages.push({
          id,
          contentType,
          base64: Buffer.from(imageBuffer).toString("base64"),
        });
        return {
          altText: id,
          src: `ocr-pending:${id}`,
        };
      }),
    } as any
  );
  return {
    markdown: convertHtmlToMarkdown(result.value),
    pendingImages,
  };
}

function convertHtmlToMarkdown(html: string): string {
  return html
    .replace(/<table[\s\S]*?<\/table>/gi, (table) => convertTableToMarkdown(table))
    .replace(/<img\b[^>]*>/gi, (img) => convertImageToPlaceholder(img))
    .replace(/<h1>/g, "# ").replace(/<\/h1>/g, "\n\n")
    .replace(/<h2>/g, "## ").replace(/<\/h2>/g, "\n\n")
    .replace(/<strong>/g, "**").replace(/<\/strong>/g, "**")
    .replace(/<li>/g, "- ").replace(/<\/li>/g, "\n")
    .replace(/<p>/g, "").replace(/<\/p>/g, "\n\n")
    .replace(/<br\s*\/?>/g, "\n").replace(/<(?!!-- OCR_PENDING\b)[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function convertImageToPlaceholder(imgHtml: string): string {
  const id = getPendingImageIdFromSrc(getAttr(imgHtml, "src") || "") || getAttr(imgHtml, "alt") || "docx-image";
  return `\n\n${makeOcrPendingPlaceholder({ id, source: "docx", image: id, reason: "embedded_image" })}\n\n`;
}

function getAttr(html: string, name: string): string | null {
  const match = html.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function getPendingImageIdFromSrc(src: string): string | null {
  return src.startsWith("ocr-pending:") ? src.slice("ocr-pending:".length) : null;
}

function convertTableToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((rowMatch) => {
    const rowHtml = rowMatch[0];
    return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) =>
      cleanTableCell(cellMatch[1])
    );
  }).filter((row) => row.length > 0);

  if (!rows.length) return "";

  const colCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...new Array(colCount - row.length).fill("")]);
  const escape = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const lines = [
    "| " + normalized[0].map(escape).join(" | ") + " |",
    "|" + normalized[0].map(() => ":---|").join(""),
  ];

  for (const row of normalized.slice(1)) {
    lines.push("| " + row.map(escape).join(" | ") + " |");
  }

  return "\n\n" + lines.join("\n") + "\n\n";
}

function cleanTableCell(html: string): string {
  return html
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
