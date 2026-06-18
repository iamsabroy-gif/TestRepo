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
    get: () => Promise.resolve(pdfjsWorker),
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
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .filter((item) => "str" in item && typeof (item as { str?: string }).str === "string")
      .map((item) => (item as { str: string }).str);
    pages.push(strings.join(" "));
  }

  await doc.destroy();
  return pages.join("\n");
}

export async function GET() {
  try {
    const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    Object.defineProperty(pdfjsLib.PDFWorker, "_setupFakeWorkerGlobal", {
    get: () => Promise.resolve(pdfjsWorker),
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

function parseBankStatementText(text: string): ParsedRow[] {
  const results: ParsedRow[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const datePattern = /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;

    const date = normalizeDate(dateMatch[1]);
    if (!date) continue;

    const restOfLine = line.substring(dateMatch[0].length);
    const amounts: number[] = [];
    const amountRegex = /(\d{1,3}(?:,\d{2,3})*\.\d{1,2})/g;
    let match;
    while ((match = amountRegex.exec(restOfLine)) !== null) {
      const val = parseFloat(match[1].replace(/,/g, ""));
      if (val > 0) amounts.push(val);
    }

    const firstAmountIdx = restOfLine.search(/\d{1,3}(?:,\d{2,3})*\.\d{1,2}/);
    let description = firstAmountIdx > 0
      ? restOfLine.substring(0, firstAmountIdx).trim()
      : restOfLine.trim();

    if (description.length < 5 && i + 1 < lines.length && !lines[i + 1].match(datePattern)) {
      description += " " + lines[i + 1].trim();
    }

    description = description.replace(/\s+/g, " ").substring(0, 100).trim();
    if (!description) description = "Bank transaction";

    if (amounts.length >= 3) {
      const debit = amounts[0];
      const credit = amounts[1];
      if (credit > debit && credit > 0) {
        results.push({ date, description, amount: credit, type: "income" });
      } else if (debit > 0) {
        results.push({ date, description, amount: debit, type: "expense" });
      }
    } else if (amounts.length === 2) {
      const amount = amounts[0];
      const isCredit = /credit|cr\b|deposit|received|neft.*from|upi.*from|imps.*from|interest/i.test(line);
      if (amount > 0) {
        results.push({ date, description, amount, type: isCredit ? "income" : "expense" });
      }
    } else if (amounts.length === 1) {
      const isCredit = /credit|cr\b|deposit|received|interest|salary|refund/i.test(line);
      results.push({ date, description, amount: amounts[0], type: isCredit ? "income" : "expense" });
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
