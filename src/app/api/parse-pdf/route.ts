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

interface ParsedRow {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
}

interface TextCell {
  str: string;
  x: number;
}

interface TextRow {
  cells: TextCell[];
  text: string;
}

interface ColumnPositions {
  debitX: number;
  creditX: number;
  balanceX: number | null;
}

async function extractStructuredText(
  data: Uint8Array,
  password?: string
): Promise<{ rows: TextRow[]; text: string }> {
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
  const allRows: TextRow[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    const items: { str: string; x: number; y: number }[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const t = item as { str: string; transform: number[] };
      if (!t.str || !t.str.trim()) continue;
      items.push({ str: t.str.trim(), x: t.transform[4], y: t.transform[5] });
    }

    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const yTolerance = 3;
    let rowStart = 0;
    while (rowStart < items.length) {
      const rowY = items[rowStart].y;
      let rowEnd = rowStart + 1;
      while (rowEnd < items.length && Math.abs(items[rowEnd].y - rowY) <= yTolerance) {
        rowEnd++;
      }
      const cells = items.slice(rowStart, rowEnd).sort((a, b) => a.x - b.x);
      const textCells: TextCell[] = cells.map((c) => ({ str: c.str, x: c.x }));
      const text = cells.map((c) => c.str).join(" \t ");
      allRows.push({ cells: textCells, text });
      rowStart = rowEnd;
    }
  }

  await doc.destroy();
  const text = allRows.map((r) => r.text).join("\n");
  return { rows: allRows, text };
}

function detectColumnPositions(rows: TextRow[]): ColumnPositions | null {
  for (const row of rows.slice(0, 40)) {
    let debitX = -1;
    let creditX = -1;
    let balanceX = -1;

    for (const cell of row.cells) {
      const lower = cell.str.toLowerCase().trim();
      if (/^(debit|withdrawal|dr\.?|debit\s*amount)$/i.test(lower) && debitX === -1) {
        debitX = cell.x;
      }
      if (/^(credit|deposit|cr\.?|credit\s*amount)$/i.test(lower) && creditX === -1) {
        creditX = cell.x;
      }
      if (/^(balance|closing|running|closing\s*balance)$/i.test(lower) && balanceX === -1) {
        balanceX = cell.x;
      }
    }

    if (debitX >= 0 && creditX >= 0) {
      return { debitX, creditX, balanceX: balanceX >= 0 ? balanceX : null };
    }
  }
  return null;
}

function classifyAmountByPosition(
  x: number,
  cols: ColumnPositions
): "debit" | "credit" | "balance" | null {
  const tolerance = 50;

  const candidates: { col: "debit" | "credit" | "balance"; dist: number }[] = [
    { col: "debit", dist: Math.abs(x - cols.debitX) },
    { col: "credit", dist: Math.abs(x - cols.creditX) },
  ];
  if (cols.balanceX !== null) {
    candidates.push({ col: "balance", dist: Math.abs(x - cols.balanceX) });
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].dist <= tolerance ? candidates[0].col : null;
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

    const { rows, text } = await extractStructuredText(data, password);
    const transactions = parseBankStatement(rows, text);

    return NextResponse.json({ transactions, rawText: text.substring(0, 2000) });
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

const datePattern = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/;
const amountRegex = /(\d{1,3}(?:,\d{2,3})*\.\d{1,2})/;

function parseBankStatement(rows: TextRow[], text: string): ParsedRow[] {
  const cols = detectColumnPositions(rows);

  if (cols) {
    const results = parseWithColumnPositions(rows, cols);
    if (results.length > 0) return results;
  }

  const results = parseFromFlatText(text);
  if (results.length > 0) return results;

  return parseEmailStyle(text);
}

function parseWithColumnPositions(rows: TextRow[], cols: ColumnPositions): ParsedRow[] {
  const results: ParsedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dateMatch = row.text.match(datePattern);
    if (!dateMatch) continue;

    const date = normalizeDate(dateMatch[1]);
    if (!date) continue;

    let debitAmount = 0;
    let creditAmount = 0;

    for (const cell of row.cells) {
      const m = cell.str.match(amountRegex);
      if (!m) continue;

      const val = parseFloat(m[1].replace(/,/g, ""));
      if (val <= 0) continue;

      const classification = classifyAmountByPosition(cell.x, cols);
      if (classification === "debit" && debitAmount === 0) {
        debitAmount = val;
      } else if (classification === "credit" && creditAmount === 0) {
        creditAmount = val;
      }
    }

    if (debitAmount === 0 && creditAmount === 0) continue;

    let description = "";
    for (const cell of row.cells) {
      const trimmed = cell.str.trim();
      if (
        trimmed &&
        !amountRegex.test(trimmed) &&
        !datePattern.test(trimmed) &&
        trimmed.length > 1
      ) {
        description += (description ? " " : "") + trimmed;
      }
    }

    if (description.length < 5 && i + 1 < rows.length) {
      const nextRow = rows[i + 1];
      if (!nextRow.text.match(datePattern)) {
        for (const cell of nextRow.cells) {
          const trimmed = cell.str.trim();
          if (trimmed && !amountRegex.test(trimmed) && !datePattern.test(trimmed)) {
            description += " " + trimmed;
          }
        }
      }
    }

    description = description.replace(/\s+/g, " ").substring(0, 100).trim();
    if (!description) description = "Bank transaction";

    if (creditAmount > 0 && debitAmount === 0) {
      results.push({ date, description, amount: creditAmount, type: "income" });
    } else if (debitAmount > 0 && creditAmount === 0) {
      results.push({ date, description, amount: debitAmount, type: "expense" });
    } else if (debitAmount > 0 && creditAmount > 0) {
      results.push({ date, description, amount: debitAmount, type: "expense" });
      results.push({ date, description: description + " (Credit)", amount: creditAmount, type: "income" });
    }
  }

  return results;
}

function parseFromFlatText(text: string): ParsedRow[] {
  const results: ParsedRow[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;

    const date = normalizeDate(dateMatch[1]);
    if (!date) continue;

    const parts = line.split(/\t/);
    const amounts: number[] = [];

    for (const p of parts) {
      const m = p.trim().match(amountRegex);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val > 0) amounts.push(val);
      }
    }

    if (amounts.length === 0) continue;

    let description = "";
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed && !amountRegex.test(trimmed) && !datePattern.test(trimmed) && trimmed.length > 1) {
        description += (description ? " " : "") + trimmed;
      }
    }
    if (description.length < 5 && i + 1 < lines.length && !lines[i + 1].match(datePattern)) {
      const nextParts = lines[i + 1].split(/\t/)
        .map((p) => p.trim())
        .filter((p) => p && !amountRegex.test(p) && !datePattern.test(p));
      if (nextParts.length) description += " " + nextParts.join(" ");
    }
    description = description.replace(/\s+/g, " ").substring(0, 100).trim();
    if (!description) description = "Bank transaction";

    const isCredit = /credit|cr\b|deposit|received|neft.*from|upi.*from|imps.*from|interest|salary|refund|cashback|reversal/i.test(line);
    const isDebit = /debit|dr\b|paid|withdraw|purchase|upi.*to|neft.*to|imps.*to|emi|charge|fee|upi\/dr/i.test(line);

    const amount = amounts[0];

    if (isCredit && !isDebit) {
      results.push({ date, description, amount, type: "income" });
    } else if (isDebit && !isCredit) {
      results.push({ date, description, amount, type: "expense" });
    } else {
      results.push({ date, description, amount, type: "expense" });
    }
  }

  return results;
}

function parseEmailStyle(text: string): ParsedRow[] {
  const results: ParsedRow[] = [];
  const emailAmountRegex = /(?:RS\.?|INR|USD|\$|₹)\s*([\d,]+\.?\d*)/gi;
  const emailDateRegex = /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/g;
  const debitKeywords = /debited|spent|paid|charged|withdrawn|purchase/i;
  const creditKeywords = /credited|received|refund|cashback|deposited|interest/i;

  const lines = text.split("\n");
  for (const line of lines) {
    const amountMatch = emailAmountRegex.exec(line);
    emailAmountRegex.lastIndex = 0;
    if (!amountMatch) continue;

    const amount = parseFloat(amountMatch[1].replace(/,/g, "")) || 0;
    if (amount <= 0) continue;

    const dateMatch = emailDateRegex.exec(line);
    emailDateRegex.lastIndex = 0;
    const date = dateMatch ? normalizeDate(dateMatch[1]) : new Date().toISOString().split("T")[0];

    const type = creditKeywords.test(line) ? "income" as const : debitKeywords.test(line) ? "expense" as const : "expense" as const;

    results.push({ date, description: line.trim().substring(0, 100), amount, type });
  }

  return results;
}

function normalizeDate(dateStr: string): string {
  const cleaned = dateStr.trim();
  const parts = cleaned.split(/[-/.]/);
  if (parts.length !== 3) return "";

  let [a, b, c] = parts.map(Number);
  if (isNaN(a) || isNaN(b) || isNaN(c)) return "";

  if (c < 100) c += 2000;

  if (a > 31) return `${a}-${String(b).padStart(2, "0")}-${String(c).padStart(2, "0")}`;
  if (b > 12) return `${c}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;

  return `${c}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
}
