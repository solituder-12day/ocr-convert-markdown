import { TFile, TFolder, Vault, normalizePath } from "obsidian";

export async function writeMarkdownFile(vault: Vault, outputDir: string, outName: string, markdown: string, debug?: (msg: string) => void) {
  const outDir = normalizePath(outputDir || "");
  const outPath = normalizePath(outDir ? `${outDir}/${outName}` : outName);
  const dirPath = outPath.split("/").slice(0, -1).join("/");

  if (dirPath) await ensureVaultFolder(vault, dirPath);

  const existing = vault.getAbstractFileByPath(outPath);
  if (existing instanceof TFile) {
    debug?.(`Overwriting existing file: ${outPath}`);
    await vault.modify(existing, markdown);
    return;
  }
  if (existing) {
    throw new Error(`Output path exists and is not a file: ${outPath}`);
  }

  debug?.(`Creating new file: ${outPath}`);
  await vault.create(outPath, markdown);
}

export async function ensureVaultFolder(vault: Vault, dirPath: string) {
  const parts = normalizePath(dirPath).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error(`Output directory conflicts with a file: ${current}`);
    await vault.createFolder(current);
  }
}
