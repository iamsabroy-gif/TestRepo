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

  const yTolerance = 3;
  const rawRows: TextItem[][] = [];
  let rowStart = 0;
  while (rowStart < allItems.length) {
    const rowY = allItems[rowStart].y;
    let rowEnd = rowStart + 1;
    while (rowEnd < allItems.length && Math.abs(allItems[rowEnd].y - rowY) <= yTolerance) {
      rowEnd++;
    }
    rawRows.push(allItems.slice(rowStart, rowEnd).sort((a, b) => a.x - b.x));
    rowStart = rowEnd;
  }

  const colBoundaries = findColumnBoundaries(rawRows);
  if (colBoundaries.length === 0) {
    return { headers: [], rows: [], suggestions: {} };
  }

  function assignToColumn(x: number): number {
    let best = 0;
    let bestDist = Math.abs(x - colBoundaries[0]);
    for (let i = 1; i < colBoundaries.length; i++) {
      const d = Math.abs(x - colBoundaries[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  const gridRows: string[][] = [];
  for (const rawRow of rawRows) {
    const row = new Array(colBoundaries.length).fill("");
    for (const item of rawRow) {
      const col = assignToColumn(item.x);
      row[col] = row[col] ? row[col] + " " + item.str : item.str;
    }
    gridRows.push(row);
  }

  const { headerIdx, headers } = detectHeaderRow(gridRows, colBoundaries.length);
  const dataRows = gridRows.slice(headerIdx + 1).filter((row) =>
    row.some((cell) => cell.trim().length > 0)
  );

  const suggestions = suggestMappings(headers);

  return { headers, rows: dataRows, suggestions };
}

function findColumnBoundaries(rawRows: TextItem[][]): number[] {
  const xValues: number[] = [];
  for (const row of rawRows) {
    for (const item of row) {
      xValues.push(item.x);
    }
  }
  if (xValues.length === 0) return [];

  xValues.sort((a, b) => a - b);

  const bucketSize = 8;
  const buckets: Map<number, number[]> = new Map();
  for (const x of xValues) {
    const key = Math.round(x / bucketSize) * bucketSize;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(x);
  }

  const clusters: { center: number; count: number }[] = [];
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);

  let i = 0;
  while (i < sorted.length) {
    let j = i;
    let totalX = 0;
    let totalCount = 0;
    while (j < sorted.length && sorted[j][0] - sorted[i][0] <= bucketSize * 2) {
      const vals = sorted[j][1];
      totalX += vals.reduce((a, b) => a + b, 0);
      totalCount += vals.length;
      j++;
    }
    clusters.push({ center: totalX / totalCount, count: totalCount });
    i = j;
  }

  const minCount = Math.max(2, rawRows.length * 0.05);
  return clusters
    .filter((c) => c.count >= minCount)
    .map((c) => c.center);
}

function detectHeaderRow(
  gridRows: string[][],
  colCount: number
): { headerIdx: number; headers: string[] } {
  const headerKeywords = /date|particulars|narration|description|details|debit|credit|withdrawal|deposit|balance|amount|cheque|ref|chq|value|txn|transaction|dr|cr/i;

  for (let i = 0; i < Math.min(gridRows.length, 30); i++) {
    const row = gridRows[i];
    const nonEmpty = row.filter((c) => c.trim().length > 0);
    if (nonEmpty.length < 3) continue;

    const matchCount = row.filter((c) => headerKeywords.test(c.trim())).length;
    if (matchCount >= 2) {
      return { headerIdx: i, headers: row.map((c) => c.trim()) };
    }
  }

  return {
    headerIdx: -1,
    headers: Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`),
  };
}

function suggestMappings(headers: string[]): Record<string, number> {
  const suggestions: Record<string, number> = {};

  const datePattern = /^(date|txn\s*date|transaction\s*date|value\s*date|post\s*date)$/i;
  const descPattern = /^(particulars|narration|description|details|transaction\s*details?|remark|memo)$/i;
  const debitPattern = /^(debit|withdrawal|dr\.?|debit\s*am(oun)?t|withdrawal\s*am(oun)?t|money\s*out|outflow|debit\s*\(dr\))$/i;
  const creditPattern = /^(credit|deposit|cr\.?|credit\s*am(oun)?t|deposit\s*am(oun)?t|money\s*in|inflow|credit\s*\(cr\))$/i;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    if (!h) continue;
    if (datePattern.test(h) && suggestions.date === undefined) suggestions.date = i;
    if (descPattern.test(h) && suggestions.description === undefined) suggestions.description = i;
    if (debitPattern.test(h) && suggestions.debit === undefined) suggestions.debit = i;
    if (creditPattern.test(h) && suggestions.credit === undefined) suggestions.credit = i;
  }

  return suggestions;
}
