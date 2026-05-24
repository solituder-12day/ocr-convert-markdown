export function log(level: "info" | "warn" | "error" | "debug", msg: string, data?: any) {
  const prefix = `[OCR convert Markdown]`;
  const ts = new Date().toLocaleTimeString();
  const line = `${ts} ${prefix} ${msg}`;
  switch (level) {
    case "info":  console.log(line, data !== undefined ? data : ""); break;
    case "warn":  console.warn(line, data !== undefined ? data : ""); break;
    case "error": console.error(line, data !== undefined ? data : ""); break;
    case "debug": console.debug(line, data !== undefined ? data : ""); break;
  }
}
