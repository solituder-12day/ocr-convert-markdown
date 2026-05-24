import { execFile } from "child_process";
import { access, mkdtemp, readdir, readFile, rm } from "fs/promises";
import { constants } from "fs";
import { tmpdir } from "os";
import { basename, extname, join } from "path";
import type { PdfOcrSettings } from "../types";

export type LocalConverterMode = PdfOcrSettings["localConverterMode"];
export type LocalConverterEngine = Exclude<LocalConverterMode, "disabled" | "auto">;

export interface LocalConverterResult {
  markdown: string;
  engine: LocalConverterEngine;
}

export function chooseLocalConverter(
  settings: Pick<PdfOcrSettings, "localConverterMode" | "localConverterCommand">,
  ext: string,
  availableCommands: Set<string>
): LocalConverterEngine | null {
  if (settings.localConverterMode === "disabled") return null;
  if (settings.localConverterMode === "custom") return settings.localConverterCommand.trim() ? "custom" : null;

  if (settings.localConverterMode === "docling") {
    return availableCommands.has("docling") ? "docling" : null;
  }

  if (settings.localConverterMode === "marker") {
    return ext === ".pdf" && availableCommands.has("marker_single") ? "marker" : null;
  }

  if (availableCommands.has("docling")) return "docling";
  if (ext === ".pdf" && availableCommands.has("marker_single")) return "marker";
  return null;
}

export function buildLocalConverterCommand(
  engine: LocalConverterEngine,
  inputPath: string,
  outputDir: string,
  customTemplate: string
): { command: string; args: string[] } {
  if (engine === "docling") {
    return { command: "docling", args: [inputPath, "--to", "md", "--output", outputDir] };
  }

  if (engine === "marker") {
    return { command: "marker_single", args: [inputPath, "--output_dir", outputDir, "--output_format", "markdown"] };
  }

  const parts = parseCommandTemplate(customTemplate);
  if (!parts.length) throw new Error("Local converter custom command is empty");
  const [command, ...args] = parts.map((part) =>
    part.replaceAll("{input}", inputPath).replaceAll("{output}", outputDir)
  );
  return { command, args };
}

export function parseCommandTemplate(template: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template))) {
    parts.push(match[1] ?? match[2] ?? match[0]);
  }
  return parts;
}

export async function convertWithLocalEngine(
  inputPath: string,
  ext: string,
  settings: Pick<PdfOcrSettings, "localConverterMode" | "localConverterCommand">,
  log?: (message: string) => void
): Promise<LocalConverterResult | null> {
  const availableCommands = await detectLocalCommands();
  const engine = chooseLocalConverter(settings, ext, availableCommands);
  if (!engine) return null;

  const outputDir = await mkdtemp(join(tmpdir(), "ocr-convert-markdown-"));
  try {
    const { command, args } = buildLocalConverterCommand(engine, inputPath, outputDir, settings.localConverterCommand);
    log?.(`Local converter ${engine}: ${command} ${args.join(" ")}`);
    await execFileAsync(command, args, 180_000);
    const markdown = await readBestMarkdownOutput(outputDir, inputPath);
    if (!markdown.trim()) throw new Error(`${engine} produced empty Markdown`);
    return { markdown, engine };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

async function detectLocalCommands(): Promise<Set<string>> {
  const commands = ["docling", "marker_single"];
  const available = await Promise.all(commands.map(async (command) => {
    try {
      await execFileAsync(command, ["--version"], 10_000);
      return command;
    } catch {
      return null;
    }
  }));
  return new Set(available.filter((command): command is string => !!command));
}

async function readBestMarkdownOutput(outputDir: string, inputPath: string): Promise<string> {
  const files = await listFiles(outputDir);
  const markdownFiles = files.filter((file) => file.toLowerCase().endsWith(".md"));
  if (!markdownFiles.length) throw new Error("Local converter did not create a Markdown file");

  const inputBase = basename(inputPath, extname(inputPath)).toLowerCase();
  const preferred = markdownFiles.find((file) => basename(file, ".md").toLowerCase() === inputBase) ?? markdownFiles[0];
  return readFile(preferred, "utf8");
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

async function execFileAsync(command: string, args: string[], timeout: number): Promise<void> {
  await access(command, constants.X_OK).catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const details = [stderr, stdout].filter(Boolean).join("\n").trim();
        reject(new Error(details || error.message));
        return;
      }
      resolve();
    });
  });
}
