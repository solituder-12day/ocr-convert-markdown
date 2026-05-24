export type OcrPendingSource = "pdf" | "docx";

export interface OcrPendingMarker {
  id: string;
  source: OcrPendingSource;
  reason: string;
  page?: number;
  image?: string;
}

export function makeOcrPendingPlaceholder(marker: OcrPendingMarker): string {
  const attrs = [
    ["id", marker.id],
    ["source", marker.source],
    marker.page === undefined ? null : ["page", String(marker.page)],
    marker.image === undefined ? null : ["image", marker.image],
    ["reason", marker.reason],
  ].filter((entry): entry is string[] => !!entry);

  return `<!-- OCR_PENDING ${attrs.map(([key, value]) => `${key}="${escapeAttr(value)}"`).join(" ")} -->`;
}

export function replaceOcrPendingPlaceholder(markdown: string, id: string, replacement: string): string {
  const pattern = new RegExp(`<!--\\s*OCR_PENDING\\s+[^>]*id="${escapeRegExp(id)}"[^>]*-->`, "g");
  return markdown.replace(pattern, replacement.trim());
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
