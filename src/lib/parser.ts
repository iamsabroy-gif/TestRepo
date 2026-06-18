import { ParsedStatement } from "./types";

export function parseCSV(text: string): ParsedStatement[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const results: ParsedStatement[] = [];

  const dateIdx = findColumnIndex(header, ["date", "transaction date", "posting date", "txn date"]);
  const descIdx = findColumnIndex(header, ["description", "narration", "details", "particulars", "remarks"]);
  const amountIdx = findColumnIndex(header, ["amount", "transaction amount"]);
  const debitIdx = findColumnIndex(header, ["debit", "withdrawal", "dr"]);
  const creditIdx = findColumnIndex(header, ["credit", "deposit", "cr"]);

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 2) continue;

    const date = dateIdx >= 0 ? normalizeDate(cols[dateIdx]) : "";
    const description = descIdx >= 0 ? cols[descIdx].trim() : cols[1]?.trim() || "";

    let amount = 0;
    let type: "income" | "expense" = "expense";

    if (debitIdx >= 0 && creditIdx >= 0) {
      const debit = parseAmount(cols[debitIdx]);
      const credit = parseAmount(cols[creditIdx]);
      if (credit > 0) {
        amount = credit;
        type = "income";
      } else {
        amount = debit;
        type = "expense";
      }
    } else if (amountIdx >= 0) {
      const raw = parseAmount(cols[amountIdx]);
      if (raw < 0) {
        amount = Math.abs(raw);
        type = "expense";
      } else {
        amount = raw;
        type = "income";
      }
    }

    if (date && amount > 0) {
      results.push({ date, description, amount, type });
    }
  }

  return results;
}

export function parseEmailText(text: string): ParsedStatement[] {
  const results: ParsedStatement[] = [];
  const lines = text.split("\n");

  const amountRegex = /(?:RS\.?|INR|USD|\$|₹)\s*([\d,]+\.?\d*)/gi;
  const dateRegex = /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/g;
  const debitKeywords = /debited|spent|paid|charged|withdrawn|purchase/i;
  const creditKeywords = /credited|received|refund|cashback|deposited/i;

  for (const line of lines) {
    const amountMatch = amountRegex.exec(line);
    amountRegex.lastIndex = 0;
    if (!amountMatch) continue;

    const amount = parseAmount(amountMatch[1]);
    if (amount <= 0) continue;

    const dateMatch = dateRegex.exec(line);
    dateRegex.lastIndex = 0;
    const date = dateMatch ? normalizeDate(dateMatch[1]) : new Date().toISOString().split("T")[0];

    const type: "income" | "expense" = creditKeywords.test(line) ? "income" : debitKeywords.test(line) ? "expense" : "expense";

    results.push({
      date,
      description: line.trim().substring(0, 100),
      amount,
      type,
    });
  }

  return results;
}

function findColumnIndex(header: string, candidates: string[]): number {
  const cols = parseCSVLine(header);
  for (const candidate of candidates) {
    const idx = cols.findIndex((c) => c.trim().toLowerCase().includes(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseAmount(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.-]/g, "");
  return parseFloat(cleaned) || 0;
}

function normalizeDate(dateStr: string): string {
  const cleaned = dateStr.trim();
  const parts = cleaned.split(/[-/]/);
  if (parts.length !== 3) return new Date().toISOString().split("T")[0];

  let [a, b, c] = parts.map(Number);

  if (c < 100) c += 2000;

  if (a > 31) return `${a}-${String(b).padStart(2, "0")}-${String(c).padStart(2, "0")}`;
  if (b > 12) return `${c}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;

  return `${c}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
}
