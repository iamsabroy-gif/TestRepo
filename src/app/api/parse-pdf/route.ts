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

async function extractText(data: Uint8Array, password?: string): Promise<string> {
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
  const allLines: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    const items: { str: string; x: number; y: number }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !(item as { str?: string }).str) continue;
      const t = item as { str: string; transform: number[] };
      items.push({ str: t.str, x: t.transform[4], y: Math.round(t.transform[5]) });
    }

    const rows = new Map<number, { str: string; x: number }[]>();
    for (const item of items) {
      if (!rows.has(item.y)) rows.set(item.y, []);
      rows.get(item.y)!.push({ str: item.str, x: item.x });
    }

    const sortedYs = [...rows.keys()].sort((a, b) => b - a);
    for (const y of sortedYs) {
      const cells = rows.get(y)!.sort((a, b) => a.x - b.x);
      const line = cells.map((c) => c.str).join(" \t ");
      allLines.push(line);
    }
  }

  await doc.destroy();
  return allLines.join("\n");
}

export async function GET() {
  try {
    const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    Object.defineProperty(pdfjsLib.PDFWorker, "_setupFakeWorkerGlobal", {
    get: () => Promise.resolve(pdfjsWorker.WorkerMessageHandler),
    configurable: true,
  });
    return NextResponse.json({
      ok: true,
      version: pdfjsLib.version || "unknown",
      workerPatched: true,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
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

    const text = await extractText(data, password);
    const transactions = parseBankStatementText(text);

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

function detectHeaderColumns(lines: string[]): { debitIdx: number; creditIdx: number } | null {
  for (const line of lines.slice(0, 20)) {
    const lower = line.toLowerCase();
    if (/debit|withdrawal/i.test(lower) && /credit|deposit/i.test(lower)) {
      const parts = line.split(/\t/);
      let debitIdx = -1;
      let creditIdx = -1;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i].trim().toLowerCase();
        if (/debit|withdrawal|dr/i.test(p) && debitIdx === -1) debitIdx = i;
        if (/credit|deposit|cr/i.test(p) && creditIdx === -1) creditIdx = i;
      }
      if (debitIdx >= 0 && creditIdx >= 0) return { debitIdx, creditIdx };
    }
  }
  return null;
}

function parseBankStatementText(text: string): ParsedRow[] {
  const results: ParsedRow[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const datePattern = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/;
  const headerCols = detectHeaderColumns(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;

    const date = normalizeDate(dateMatch[1]);
    if (!date) continue;

    const parts = line.split(/\t/);
    const amounts: { value: number; colIdx: number }[] = [];
    const amountRegex = /(\d{1,3}(?:,\d{2,3})*\.\d{1,2})/;

    for (let j = 0; j < parts.length; j++) {
      const m = parts[j].trim().match(amountRegex);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val > 0) amounts.push({ value: val, colIdx: j });
      }
    }

    let description = "";
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed && !amountRegex.test(trimmed) && !datePattern.test(trimmed)) {
        description += (description ? " " : "") + trimmed;
      }
    }
    if (description.length < 5 && i + 1 < lines.length && !lines[i + 1].match(datePattern)) {
      const nextNonAmount = lines[i + 1].split(/\t/)
        .map((p) => p.trim())
        .filter((p) => p && !amountRegex.test(p) && !datePattern.test(p))
        .join(" ");
      if (nextNonAmount) description += " " + nextNonAmount;
    }
    description = description.replace(/\s+/g, " ").substring(0, 100).trim();
    if (!description) description = "Bank transaction";

    if (amounts.length === 0) continue;

    if (headerCols && amounts.length >= 2) {
      const debitAmt = amounts.find((a) => a.colIdx === headerCols.debitIdx);
      const creditAmt = amounts.find((a) => a.colIdx === headerCols.creditIdx);
      if (creditAmt && !debitAmt) {
        results.push({ date, description, amount: creditAmt.value, type: "income" });
      } else if (debitAmt && !creditAmt) {
        results.push({ date, description, amount: debitAmt.value, type: "expense" });
      } else if (debitAmt && creditAmt) {
        if (creditAmt.value > debitAmt.value) {
          results.push({ date, description, amount: creditAmt.value, type: "income" });
        } else {
          results.push({ date, description, amount: debitAmt.value, type: "expense" });
        }
      }
    } else if (amounts.length >= 3) {
      const debit = amounts[0].value;
      const credit = amounts[1].value;
      if (credit > debit && credit > 0) {
        results.push({ date, description, amount: credit, type: "income" });
      } else if (debit > 0) {
        results.push({ date, description, amount: debit, type: "expense" });
      }
    } else if (amounts.length === 2) {
      const isCredit = /credit|cr\b|deposit|received|neft.*from|upi.*from|imps.*from|interest|salary|refund/i.test(line);
      const isDebit = /debit|dr\b|paid|withdraw|purchase|upi.*to|neft.*to|imps.*to|emi|charge|fee/i.test(line);
      const amount = amounts[0].value;
      if (isCredit && !isDebit) {
        results.push({ date, description, amount, type: "income" });
      } else {
        results.push({ date, description, amount, type: "expense" });
      }
    } else {
      const isCredit = /credit|cr\b|deposit|received|interest|salary|refund|cashback|reversal/i.test(line);
      results.push({ date, description, amount: amounts[0].value, type: isCredit ? "income" : "expense" });
    }
  }

  if (results.length === 0) {
    return parseEmailStyle(text);
  }

  return results;
}

function parseEmailStyle(text: string): ParsedRow[] {
  const results: ParsedRow[] = [];
  const amountRegex = /(?:RS\.?|INR|USD|\$|₹)\s*([\d,]+\.?\d*)/gi;
  const dateRegex = /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/g;
  const debitKeywords = /debited|spent|paid|charged|withdrawn|purchase/i;
  const creditKeywords = /credited|received|refund|cashback|deposited|interest/i;

  const lines = text.split("\n");
  for (const line of lines) {
    const amountMatch = amountRegex.exec(line);
    amountRegex.lastIndex = 0;
    if (!amountMatch) continue;

    const amount = parseFloat(amountMatch[1].replace(/,/g, "")) || 0;
    if (amount <= 0) continue;

    const dateMatch = dateRegex.exec(line);
    dateRegex.lastIndex = 0;
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
