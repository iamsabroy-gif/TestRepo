import { NextRequest, NextResponse } from "next/server";

if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a: number; b: number; c: number; d: number; e: number; f: number;
    constructor(init?: number[]) {
      const v = init || [1, 0, 0, 1, 0, 0];
      this.a = v[0]; this.b = v[1]; this.c = v[2];
      this.d = v[3]; this.e = v[4]; this.f = v[5];
    }
  };
}

interface TextItem {
  str: string;
  x: number;
  y: number;
}

const DATE_REGEX = /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/;
const HEADER_KEYWORDS = /date|particulars|narration|description|details|debit|credit|withdrawal|deposit|balance|amount|cheque|ref|chq|value|txn|transaction/i;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const password = (formData.get("password") as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const table = await extractTable(data, password);

    return NextResponse.json(table);
  } catch (error) {
    console.error("PDF parse error:", error);
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    const isPasswordError =
      name === "PasswordException" ||
      /password|encrypted|decrypt|need a password/i.test(message) ||
      /password/i.test(name);
    return NextResponse.json(
      {
        error: isPasswordError
          ? "This PDF is password-protected. Please enter the password to unlock it."
          : `Failed to parse PDF: ${message || "Unknown error"}`,
        needsPassword: isPasswordError,
      },
      { status: isPasswordError ? 401 : 500 }
    );
  }
}

async function extractTable(
  data: Uint8Array,
  password?: string
): Promise<{ headers: string[]; rows: string[][]; suggestions: Record<string, number> }> {
  const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  Object.defineProperty(pdfjsLib.PDFWorker, "_setupFakeWorkerGlobal", {
    get: () => Promise.resolve(pdfjsWorker.WorkerMessageHandler),
    configurable: true,
  });

  const params: Record<string, unknown> = {
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  };
  if (password) params.password = password;

  const doc = await pdfjsLib.getDocument(params).promise;
  const allItems: TextItem[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageOffset = (i - 1) * 100000;

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const t = item as { str: string; transform: number[] };
      if (!t.str || !t.str.trim()) continue;
      allItems.push({
        str: t.str.trim(),
        x: t.transform[4],
        y: pageOffset + (10000 - t.transform[5]),
      });
    }
  }

  await doc.destroy();

  if (allItems.length === 0) {
    return { headers: [], rows: [], suggestions: {} };
  }

  allItems.sort((a, b) => a.y - b.y || a.x - b.x);

  const rawRows = groupIntoRows(allItems);

  const dateRowIndices: number[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const text = rawRows[i].map((item) => item.str).join(" ");
    if (DATE_REGEX.test(text)) {
      dateRowIndices.push(i);
    }
  }

  if (dateRowIndices.length === 0) {
    return { headers: [], rows: [], suggestions: {} };
  }

  const firstDateIdx = dateRowIndices[0];
  const contextRows: TextItem[][] = [];
  for (let i = Math.max(0, firstDateIdx - 5); i < firstDateIdx; i++) {
    contextRows.push(rawRows[i]);
  }
  for (const idx of dateRowIndices) {
    contextRows.push(rawRows[idx]);
  }
  const colBoundaries = findColumnBoundaries(contextRows, dateRowIndices.length);

  if (colBoundaries.length === 0) {
    return { headers: [], rows: [], suggestions: {} };
  }

  function assignToColumn(x: number): number {
    let best = 0;
    let bestDist = Math.abs(x - colBoundaries[0]);
    for (let k = 1; k < colBoundaries.length; k++) {
      const d = Math.abs(x - colBoundaries[k]);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return best;
  }

  function rowToGrid(items: TextItem[]): string[] {
    const row = new Array(colBoundaries.length).fill("");
    for (const item of items) {
      const col = assignToColumn(item.x);
      row[col] = row[col] ? row[col] + " " + item.str : item.str;
    }
    return row;
  }

  let headerRow: string[] | null = null;
  for (let i = firstDateIdx - 1; i >= Math.max(0, firstDateIdx - 10); i--) {
    const text = rawRows[i].map((item) => item.str).join(" ");
    const matches = rawRows[i].filter((item) => HEADER_KEYWORDS.test(item.str)).length;
    if (matches >= 2 || (matches >= 1 && HEADER_KEYWORDS.test(text))) {
      headerRow = rowToGrid(rawRows[i]);
      break;
    }
  }

  if (!headerRow) {
    headerRow = Array.from({ length: colBoundaries.length }, (_, i) => `Column ${i + 1}`);
  }

  const dataRows: string[][] = [];
  for (let di = 0; di < dateRowIndices.length; di++) {
    const idx = dateRowIndices[di];
    const gridRow = rowToGrid(rawRows[idx]);

    const nextDateIdx = di + 1 < dateRowIndices.length ? dateRowIndices[di + 1] : rawRows.length;
    for (let ci = idx + 1; ci < nextDateIdx && ci < idx + 3; ci++) {
      const contText = rawRows[ci].map((item) => item.str).join(" ");
      if (DATE_REGEX.test(contText)) break;
      if (rawRows[ci].length === 0) continue;

      const contGrid = rowToGrid(rawRows[ci]);
      for (let c = 0; c < contGrid.length; c++) {
        if (contGrid[c] && !contGrid[c].match(/^\d{1,3}(,\d{2,3})*\.\d{1,2}$/)) {
          gridRow[c] = gridRow[c] ? gridRow[c] + " " + contGrid[c] : contGrid[c];
        }
      }
    }

    dataRows.push(gridRow);
  }

  const suggestions = suggestMappings(headerRow);

  return { headers: headerRow, rows: dataRows, suggestions };
}

function groupIntoRows(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return [];

  const rows: TextItem[][] = [];
  let rowStart = 0;

  while (rowStart < items.length) {
    const rowY = items[rowStart].y;
    let rowEnd = rowStart + 1;
    while (rowEnd < items.length && Math.abs(items[rowEnd].y - rowY) <= 3) {
      rowEnd++;
    }
    rows.push(items.slice(rowStart, rowEnd).sort((a, b) => a.x - b.x));
    rowStart = rowEnd;
  }

  return rows;
}

function findColumnBoundaries(allRows: TextItem[][], dateRowCount: number): number[] {
  const xValues: number[] = [];
  for (const row of allRows) {
    for (const item of row) {
      xValues.push(item.x);
    }
  }
  if (xValues.length === 0) return [];

  xValues.sort((a, b) => a - b);

  const gap = 20;
  const clusters: { sum: number; count: number }[] = [];
  let clusterSum = xValues[0];
  let clusterCount = 1;

  for (let i = 1; i < xValues.length; i++) {
    if (xValues[i] - xValues[i - 1] <= gap) {
      clusterSum += xValues[i];
      clusterCount++;
    } else {
      clusters.push({ sum: clusterSum, count: clusterCount });
      clusterSum = xValues[i];
      clusterCount = 1;
    }
  }
  clusters.push({ sum: clusterSum, count: clusterCount });

  const minCount = Math.max(1, Math.floor(dateRowCount * 0.1));

  return clusters
    .filter((c) => c.count >= minCount)
    .map((c) => c.sum / c.count);
}

function suggestMappings(headers: string[]): Record<string, number> {
  const suggestions: Record<string, number> = {};

  const isDrCrCombo = (h: string) => /dr\s*\/\s*cr|cr\s*\/\s*dr|type/i.test(h);

  const patterns: [string, (h: string) => boolean][] = [
    ["date", (h) => /date|txn\s*date|transaction\s*date|value\s*date|post\s*date/i.test(h)],
    ["description", (h) => /particulars|narration|description|details|transaction\s*details?|remark|memo/i.test(h)],
    ["debit", (h) => !isDrCrCombo(h) && /debit|withdrawal|debit\s*am|withdrawal\s*am|money\s*out|outflow/i.test(h)],
    ["credit", (h) => !isDrCrCombo(h) && /credit|deposit|credit\s*am|deposit\s*am|money\s*in|inflow/i.test(h)],
  ];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    if (!h) continue;
    for (const [key, test] of patterns) {
      if (test(h) && suggestions[key] === undefined) {
        suggestions[key] = i;
      }
    }
  }

  return suggestions;
}
