export interface OcrModelConfig {
  id: string;
  name: string;
  provider: "openai" | "gemini";
  apiUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens: number;
  enabled: boolean;
}

export interface PdfOcrSettings {
  models: OcrModelConfig[];
  language: "zh" | "en";
  debugMode: boolean;
  outputDir: string;
  localConverterMode: "disabled" | "auto" | "docling" | "marker" | "custom";
  localConverterCommand: string;
  pdfOcrMode: "speed" | "balanced" | "accuracy";
  pdfOcrConcurrency: number;
  pdfOcrMaxPixels: number;
  pdfOcrHighPrecisionRetry: boolean;
  /** @deprecated Kept only to migrate older saved settings. */
  preferPdfOcr: boolean;
}

export interface OcrQuality {
  ok: boolean;
  reason?: string;
}

export interface PdfTextQuality {
  ok: boolean;
  reason?: string;
}
