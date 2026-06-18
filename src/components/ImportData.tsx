"use client";

import { useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { Transaction, ParsedStatement } from "@/lib/types";
import { parseCSV, parseEmailText } from "@/lib/parser";
import { getCurrency, formatAmount } from "@/lib/currency";

interface Props {
  onImport: (transactions: Transaction[]) => void;
}

type ImportMode = "pdf" | "csv" | "email";
type ColumnRole = "ignore" | "date" | "description" | "debit" | "credit" | "amount" | "type";

interface PdfTable {
  headers: string[];
  rows: string[][];
  suggestions: Record<string, number>;
}

const COLUMN_ROLES: { value: ColumnRole; label: string; desc: string }[] = [
  { value: "ignore", label: "Skip", desc: "" },
  { value: "date", label: "Date", desc: "" },
  { value: "description", label: "Description", desc: "" },
  { value: "debit", label: "Debit (Expense)", desc: "Only expense amounts" },
  { value: "credit", label: "Credit (Income)", desc: "Only income amounts" },
  { value: "amount", label: "Amount (Both)", desc: "Single column with Dr & Cr" },
  { value: "type", label: "Dr/Cr Type", desc: "Optional: helps classify Amount" },
];

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

export default function ImportData({ onImport }: Props) {
  const [mode, setMode] = useState<ImportMode>("pdf");
  const [emailText, setEmailText] = useState("");
  const [preview, setPreview] = useState<ParsedStatement[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pdfTable, setPdfTable] = useState<PdfTable | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnRole[]>([]);

  function resetState() {
    setPreview([]);
    setShowPreview(false);
    setError(null);
    setNeedsPassword(false);
    setPdfPassword("");
    setPendingPdfFile(null);
    setPdfTable(null);
    setColumnMap([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setNeedsPassword(false);
    setPdfTable(null);
    setColumnMap([]);
    setShowPreview(false);

    if (file.name.toLowerCase().endsWith(".pdf")) {
      setPendingPdfFile(file);
    } else {
      setPendingPdfFile(null);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const parsed = parseCSV(text);
        setPreview(parsed);
        setShowPreview(true);
      };
      reader.readAsText(file);
    }
  }

  async function handleParsePdf() {
    if (!pendingPdfFile) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", pendingPdfFile);
      if (pdfPassword) formData.append("password", pdfPassword);

      const res = await fetch("/api/parse-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.needsPassword) {
          setNeedsPassword(true);
          setError(pdfPassword ? "Incorrect password. Please try again." : "This PDF is password-protected. Enter the password and click Parse.");
          return;
        }
        throw new Error(data.error || "Failed to parse PDF");
      }

      setNeedsPassword(false);
      setPendingPdfFile(null);
      setPdfPassword("");

      const table = data as PdfTable;
      if (!table.headers || table.headers.length === 0 || !table.rows || table.rows.length === 0) {
        setError("No table data found in this PDF. It may be image-based (scanned) or in an unsupported format.");
        return;
      }

      setPdfTable(table);

      const initialMap: ColumnRole[] = table.headers.map(() => "ignore" as ColumnRole);
      const s = table.suggestions;
      if (s.date !== undefined) initialMap[s.date] = "date";
      if (s.description !== undefined) initialMap[s.description] = "description";
      if (s.debit !== undefined) initialMap[s.debit] = "debit";
      if (s.credit !== undefined) initialMap[s.credit] = "credit";
      if (s.amount !== undefined) initialMap[s.amount] = "amount";
      if (s.type !== undefined) initialMap[s.type] = "type";
      setColumnMap(initialMap);

      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse PDF");
    } finally {
      setLoading(false);
    }
  }

  function handleColumnChange(colIdx: number, role: ColumnRole) {
    setColumnMap((prev) => {
      const next = [...prev];
      if (role !== "ignore") {
        for (let i = 0; i < next.length; i++) {
          if (next[i] === role) next[i] = "ignore";
        }
      }
      next[colIdx] = role;
      return next;
    });
  }

  function detectTransactionType(
    amountCell: string,
    row: string[],
    typeIdx: number,
    descIdx: number,
    description: string
  ): "income" | "expense" {
    const creditIndicator = /\bcr\.?\b|credit|deposit|credited|received/i;
    const debitIndicator = /\bdr\.?\b|debit|withdrawal|debited|paid/i;
    const creditKeywords = /credit|cr\b|deposit|received|salary|refund|cashback|reversal|interest|neft.*from|upi.*from|imps.*from|upi\/cr/i;
    const debitKeywords = /debit|dr\b|paid|withdraw|purchase|upi.*to|neft.*to|imps.*to|emi|charge|fee|upi\/dr/i;

    if (typeIdx !== -1) {
      const typeVal = (row[typeIdx] || "").trim();
      if (creditIndicator.test(typeVal)) return "income";
      if (debitIndicator.test(typeVal)) return "expense";
    }

    if (creditIndicator.test(amountCell) && !debitIndicator.test(amountCell)) return "income";
    if (debitIndicator.test(amountCell) && !creditIndicator.test(amountCell)) return "expense";

    const rowText = row.join(" ");
    if (creditKeywords.test(description) && !debitKeywords.test(description)) return "income";
    if (debitKeywords.test(description) && !creditKeywords.test(description)) return "expense";
    if (creditKeywords.test(rowText) && !debitKeywords.test(rowText)) return "income";

    return "expense";
  }

  function handleImportMapped() {
    if (!pdfTable) return;

    const dateIdx = columnMap.indexOf("date");
    const descIdx = columnMap.indexOf("description");
    const debitIdx = columnMap.indexOf("debit");
    const creditIdx = columnMap.indexOf("credit");
    const amountIdx = columnMap.indexOf("amount");
    const typeIdx = columnMap.indexOf("type");

    if (dateIdx === -1) {
      setError("Please select which column contains the Date.");
      return;
    }

    const hasDualCols = debitIdx !== -1 || creditIdx !== -1;
    const hasSingleCol = amountIdx !== -1;

    if (!hasDualCols && !hasSingleCol) {
      setError("Please select Debit/Credit columns, or use \"Amount (Both)\" for a single column.");
      return;
    }

    const amountRegex = /[\d,]+\.?\d*/;
    const dateRegex = /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/;
    const transactions: Transaction[] = [];

    for (const row of pdfTable.rows) {
      const rawDate = row[dateIdx] || "";
      const dateMatch = rawDate.match(dateRegex);
      if (!dateMatch) continue;
      const date = normalizeDate(dateMatch[0]);
      if (!date) continue;

      const description = descIdx >= 0
        ? (row[descIdx] || "").replace(/\s+/g, " ").trim().substring(0, 100) || "Bank transaction"
        : "Bank transaction";

      if (hasSingleCol) {
        const rawAmt = (row[amountIdx] || "").trim();
        const amtMatch = rawAmt.match(amountRegex);
        const amt = amtMatch ? parseFloat(amtMatch[0].replace(/,/g, "")) : 0;
        if (amt <= 0) continue;

        const txnType = detectTransactionType(rawAmt, row, typeIdx, descIdx, description);

        transactions.push({
          id: uuidv4(),
          type: txnType,
          amount: amt,
          currency: getCurrency(),
          category: "other",
          description,
          date,
        });
      } else {
        const rawDebit = debitIdx >= 0 ? (row[debitIdx] || "").trim() : "";
        const rawCredit = creditIdx >= 0 ? (row[creditIdx] || "").trim() : "";

        const debitMatch = rawDebit.match(amountRegex);
        const creditMatch = rawCredit.match(amountRegex);

        const debitAmt = debitMatch ? parseFloat(debitMatch[0].replace(/,/g, "")) : 0;
        const creditAmt = creditMatch ? parseFloat(creditMatch[0].replace(/,/g, "")) : 0;

        if (debitAmt <= 0 && creditAmt <= 0) continue;

        if (debitAmt > 0) {
          transactions.push({
            id: uuidv4(),
            type: "expense",
            amount: debitAmt,
            currency: getCurrency(),
            category: "other",
            description,
            date,
          });
        }
        if (creditAmt > 0) {
          transactions.push({
            id: uuidv4(),
            type: "income",
            amount: creditAmt,
            currency: getCurrency(),
            category: "other",
            description,
            date,
          });
        }
      }
    }

    if (transactions.length === 0) {
      setError("No valid transactions found with the selected column mapping. Please check your selections.");
      return;
    }

    onImport(transactions);
    resetState();
  }

  function handleEmailParse() {
    if (!emailText.trim()) return;
    const parsed = parseEmailText(emailText);
    setPreview(parsed);
    setShowPreview(true);
  }

  function handleConfirmImport() {
    const transactions: Transaction[] = preview.map((p) => ({
      id: uuidv4(),
      type: p.type,
      amount: p.amount,
      currency: getCurrency(),
      category: "other",
      description: p.description,
      date: p.date,
    }));
    onImport(transactions);
    resetState();
    setEmailText("");
  }

  const hasMapping = columnMap.includes("date") && (columnMap.includes("debit") || columnMap.includes("credit") || columnMap.includes("amount"));

  const modeButtons: { key: ImportMode; label: string }[] = [
    { key: "pdf", label: "PDF Statement" },
    { key: "csv", label: "CSV" },
    { key: "email", label: "Email / Text" },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Import Transactions</h2>

      <div className="flex gap-2">
        {modeButtons.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => { setMode(m.key); setShowPreview(false); setError(null); setNeedsPassword(false); setPdfTable(null); }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              mode === m.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "pdf" && !pdfTable && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Upload your bank statement PDF. You will be able to map the columns (Date, Description, Debit, Credit) after parsing.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            disabled={loading}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
          />
          {pendingPdfFile && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Password (if protected — most banks use DOB as DDMMYYYY)
                </label>
                <input
                  type="password"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  placeholder="Leave blank if not password-protected"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-800"
                />
              </div>
              <button
                type="button"
                onClick={handleParsePdf}
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Parsing...
                  </>
                ) : (
                  "Parse PDF"
                )}
              </button>
            </>
          )}
        </div>
      )}

      {mode === "pdf" && pdfTable && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Map columns from your statement
            </h3>
            <button
              onClick={resetState}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Start over
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Assign each column a role. Use <b>Debit + Credit</b> if they are separate columns, or <b>Amount (Both)</b> if debits and credits are in the same column.
          </p>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  {pdfTable.headers.map((header, i) => (
                    <th key={i} className="px-2 py-1 border-b border-gray-200 text-left min-w-[100px]">
                      <select
                        value={columnMap[i] || "ignore"}
                        onChange={(e) => handleColumnChange(i, e.target.value as ColumnRole)}
                        className={`w-full px-1.5 py-1 rounded text-xs font-medium border outline-none ${
                          columnMap[i] === "date" ? "bg-blue-50 border-blue-300 text-blue-700" :
                          columnMap[i] === "description" ? "bg-purple-50 border-purple-300 text-purple-700" :
                          columnMap[i] === "debit" ? "bg-red-50 border-red-300 text-red-700" :
                          columnMap[i] === "credit" ? "bg-emerald-50 border-emerald-300 text-emerald-700" :
                          columnMap[i] === "amount" ? "bg-amber-50 border-amber-300 text-amber-700" :
                          columnMap[i] === "type" ? "bg-indigo-50 border-indigo-300 text-indigo-700" :
                          "bg-white border-gray-200 text-gray-500"
                        }`}
                      >
                        {COLUMN_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
                <tr className="bg-gray-50">
                  {pdfTable.headers.map((header, i) => (
                    <th key={i} className="px-2 py-1.5 border-b border-gray-200 text-left font-medium text-gray-600 truncate max-w-[150px]">
                      {header || `Col ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pdfTable.rows.slice(0, 8).map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-2 py-1.5 border-b border-gray-100 truncate max-w-[150px] ${
                          columnMap[ci] === "ignore" ? "text-gray-400" : "text-gray-700"
                        }`}
                        title={cell}
                      >
                        {cell || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pdfTable.rows.length > 8 && (
            <p className="text-xs text-gray-400 text-center">
              Showing 8 of {pdfTable.rows.length} rows
            </p>
          )}

          <button
            onClick={handleImportMapped}
            disabled={!hasMapping}
            className="w-full py-2.5 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {hasMapping
              ? "Import Transactions"
              : "Select Date + Debit/Credit (or Amount) columns"}
          </button>
        </div>
      )}

      {mode === "csv" && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Upload a CSV file from your bank. Common formats with Date, Description, Amount (or Debit/Credit) columns are supported.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileSelect}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>
      )}

      {mode === "email" && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Paste transaction alerts from your bank emails or SMS. The parser detects amounts, dates, and whether it was a debit or credit.
          </p>
          <textarea
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder="Paste your bank email / SMS alerts here...&#10;&#10;Example:&#10;Your a/c XX1234 debited by Rs.500.00 on 15-01-2024 for UPI payment to Amazon"
            rows={5}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-800 text-sm resize-none"
          />
          <button
            onClick={handleEmailParse}
            className="mt-2 w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Parse Transactions
          </button>
        </div>
      )}

      {error && (
        <p className={`text-sm p-3 rounded-lg ${needsPassword ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50"}`}>{error}</p>
      )}

      {showPreview && preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Found {preview.length} transaction{preview.length !== 1 ? "s" : ""}
            </h3>
            <button
              onClick={handleConfirmImport}
              className="py-1.5 px-4 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors"
            >
              Import All
            </button>
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-2">
            {preview.map((p, i) => (
              <div key={i} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded-lg text-sm">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-gray-700">{p.description}</p>
                  <p className="text-xs text-gray-400">{p.date}</p>
                </div>
                <span className={`font-medium ${p.type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                  {p.type === "income" ? "+" : "-"}{formatAmount(p.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showPreview && preview.length === 0 && (
        <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
          No transactions could be parsed. Try a different format or paste the text directly.
        </p>
      )}
    </div>
  );
}
