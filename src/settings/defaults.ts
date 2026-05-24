import type { OcrModelConfig, PdfOcrSettings } from "../types";

export const OCR_PRESETS: OcrModelConfig[] = [
  { id: "glm",       name: "GLM-4V (智谱)",                 provider: "openai", apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",                                    apiKey: "", modelName: "glm-4v",               maxTokens: 16384, enabled: true },
  { id: "glm-flash", name: "GLM-4V-Flash (智谱)",           provider: "openai", apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",                                    apiKey: "", modelName: "glm-4v-flash",         maxTokens: 16384, enabled: true },
  { id: "minimax",   name: "MiniMax-VL (MiniMax)",           provider: "openai", apiUrl: "https://api.minimax.chat/v1/chat/completions",                                             apiKey: "", modelName: "MiniMax-VL-01",        maxTokens: 8192, enabled: true },
  { id: "", name: "Qwen-VL-Max (阿里)",             provider: "openai", apiUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",                  apiKey: "", modelName: "qwen-vl-max",           maxTokens: 16384, enabled: true },
  { id: "", name: "Qwen-VL-Plus (阿里)",            provider: "openai", apiUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",                  apiKey: "", modelName: "qwen-vl-plus",          maxTokens: 16384, enabled: true },
  { id: "", name: "DeepSeek-VL (深度求索)",         provider: "openai", apiUrl: "https://platform.deepseek.com/api/paas/v4/chat/completions",                                apiKey: "", modelName: "deepseek-vl2",          maxTokens: 16384, enabled: true },
  { id: "", name: "Moonshot-VL (月之暗面)",         provider: "openai", apiUrl: "https://api.moonshot.cn/v1/chat/completions",                                               apiKey: "", modelName: "moonshot-v1-8k",        maxTokens: 8192, enabled: true },
  { id: "gemini", name: "Gemini 2.5 Flash (Google)",      provider: "gemini", apiUrl: "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent",    apiKey: "", modelName: "gemini-2.5-flash",      maxTokens: 8192, enabled: true },
  { id: "", name: "Gemini 2.5 Pro (Google)",        provider: "gemini", apiUrl: "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent",      apiKey: "", modelName: "gemini-2.5-pro",        maxTokens: 8192, enabled: true },
  { id: "", name: "GPT-4o (OpenAI)",                provider: "openai", apiUrl: "https://api.openai.com/v1/chat/completions",                                               apiKey: "", modelName: "gpt-4o",                maxTokens: 16384, enabled: true },
  { id: "", name: "GPT-4o-mini (OpenAI)",           provider: "openai", apiUrl: "https://api.openai.com/v1/chat/completions",                                               apiKey: "", modelName: "gpt-4o-mini",           maxTokens: 16384, enabled: true },
  { id: "", name: "Pixtral Large (Mistral)",        provider: "openai", apiUrl: "https://api.mistral.ai/v1/chat/completions",                                                apiKey: "", modelName: "pixtral-large",         maxTokens: 8192, enabled: true },
  { id: "", name: "Mistral Small (Mistral)",        provider: "openai", apiUrl: "https://api.mistral.ai/v1/chat/completions",                                                apiKey: "", modelName: "mistral-small",         maxTokens: 4096, enabled: true },
  { id: "", name: "Llama 3.2 Vision (Groq)",        provider: "openai", apiUrl: "https://api.groq.com/openai/v1/chat/completions",                                           apiKey: "", modelName: "llama-3.2-11b-vision",  maxTokens: 8192, enabled: true },
  { id: "", name: "Llama 3.2 Vision (Together)",    provider: "openai", apiUrl: "https://api.together.xyz/v1/chat/completions",                                               apiKey: "", modelName: "meta-llama/Llama-3.2-11B-Vision-Instruct", maxTokens: 8192, enabled: true },
  { id: "", name: "OpenRouter (any model)",          provider: "openai", apiUrl: "https://openrouter.ai/api/v1/chat/completions",                                             apiKey: "", modelName: "openai/gpt-4o",         maxTokens: 16384, enabled: true },
];

export const DEFAULT_MODELS: OcrModelConfig[] = OCR_PRESETS.filter((p) => p.id !== "").map((p) => ({ ...p }));

export const DEFAULT_SETTINGS: PdfOcrSettings = {
  models: DEFAULT_MODELS,
  language: "en",
  debugMode: false,
  outputDir: "",
  localConverterMode: "auto",
  localConverterCommand: "",
  pdfOcrMode: "balanced",
  pdfOcrConcurrency: 2,
  pdfOcrMaxPixels: 8_000_000,
  pdfOcrHighPrecisionRetry: true,
  preferPdfOcr: false,
};

export const SUPPORTED_EXT = [".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp"];
