import * as XLSX from "xlsx";

export async function convertXlsxToMarkdown(buffer: ArrayBuffer): Promise<string> {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const lines: string[] = [];
  try {
    for (let s = 0; s < wb.SheetNames.length; s++) {
      const name = wb.SheetNames[s];
      const sheet = wb.Sheets[name];
      if (!sheet["!ref"]) continue;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const data: string[][] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[addr];
          let val = "";
          if (cell) {
            if (cell.t === "s") {
              val = String(cell.w ?? cell.v ?? "");
            } else if (cell.t === "n" && typeof cell.v === "number" && cell.v > 40000 && cell.v < 60000) {
              const d = XLSX.SSF.parse_date_code(cell.v);
              if (d) {
                const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
                val = `${d.y}/${d.m}/${d.d} ${pad(d.H)}:${pad(d.M)}:${pad(d.S)}`;
              } else {
                val = String(cell.w ?? cell.v ?? "");
              }
            } else {
              val = String(cell.w ?? cell.v ?? "");
            }
          }
          row.push(val);
        }
        data.push(row);
      }
      if (!data.length) continue;
      if (s > 0) lines.push("---");
      const colCount = Math.max(...data.map((r) => r.length));
      let minCol = 0;
      let maxCol = colCount - 1;
      while (minCol <= maxCol && data.every((r: string[]) => !r[minCol] || r[minCol] === "")) minCol++;
      while (maxCol >= minCol && data.every((r: string[]) => !r[maxCol] || r[maxCol] === "")) maxCol--;
      const trimmed = data.map((r: string[]) => r.slice(minCol, maxCol + 1));
      lines.push(`## 📊 ${name}`);
      const esc = (x: string) => String(x).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
      lines.push("| " + trimmed[0].map(esc).join(" | ") + " |");
      lines.push("|" + trimmed[0].map(() => ":---|").join(""));
      for (let r = 1; r < trimmed.length; r++) {
        const v = trimmed[r].map(esc);
        if (v.some((x: string) => x.trim())) lines.push("| " + v.join(" | ") + " |");
      }
    }
    return lines.join("\n");
  } finally {
    wb.SheetNames.forEach(name => { delete wb.Sheets[name]; });
    wb.SheetNames.length = 0;
  }
}
