// =============================================================================
// CSV Parser Utility for Client-side Lead Import
// =============================================================================

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

export function parseCsv(text: string): ParsedCsv {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      currentLine += char;
      if (inQuotes && nextChar === '"') {
        currentLine += nextChar;
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  if (lines.length === 0) {
    return { headers: [], rows: [], totalRows: 0 };
  }

  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let curVal = '';
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const nc = line[i + 1];

      if (c === '"') {
        if (inQ && nc === '"') {
          curVal += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (c === ',' && !inQ) {
        values.push(curVal.trim());
        curVal = '';
      } else {
        curVal += c;
      }
    }
    values.push(curVal.trim());
    return values;
  };

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map((h, idx) => h || `Column_${idx + 1}`);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rowValues = parseLine(lines[i]);
    if (rowValues.every((v) => v === '')) {
      continue; // skip empty line
    }
    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      rowObj[header] = rowValues[idx] ?? '';
    });
    rows.push(rowObj);
  }

  return {
    headers,
    rows,
    totalRows: rows.length,
  };
}
