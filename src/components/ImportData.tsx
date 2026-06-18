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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setNeedsPassword(false);

    if (file.name.toLowerCase().endsWith(".pdf")) {
      await handlePdfUpload(file, pdfPassword || undefined);
    } else {
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

  async function handlePdfUpload(file: File, password?: string) {
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (password) formData.append("password", password);

      const res = await fetch("/api/parse-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.needsPassword) {
          setPendingPdfFile(file);
          setNeedsPassword(true);
          setError(password ? "Incorrect password. Please try again." : "This PDF is password-protected. Enter the password below and retry.");
          return;
        }
        throw new Error(data.error || "Failed to parse PDF");
      }

      setNeedsPassword(false);
      setPendingPdfFile(null);
      setPdfPassword("");
      setPreview(data.transactions || []);
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse PDF");
    } finally {
      setLoading(false);
    }
  }

  function handleRetryWithPassword() {
    if (!pendingPdfFile || !pdfPassword) return;
    handlePdfUpload(pendingPdfFile, pdfPassword);
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
    setPreview([]);
    setShowPreview(false);
    setEmailText("");
    setError(null);
    setNeedsPassword(false);
    setPdfPassword("");
    setPendingPdfFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

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
            onClick={() => { setMode(m.key); setShowPreview(false); setError(null); setNeedsPassword(false); }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              mode === m.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "pdf" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Upload your bank statement PDF. Supports Federal Bank, Bandhan Bank, ICICI, SBI, HDFC, and other Indian bank formats. Password-protected PDFs are supported.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            disabled={loading}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
          />
          <div className="space-y-2">
            <label className="block text-xs text-gray-500">
              PDF password (if protected — most banks use DOB as DDMMYYYY)
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                placeholder="Enter PDF password"
                className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-800"
              />
              {needsPassword && pendingPdfFile && (
                <button
                  type="button"
                  onClick={handleRetryWithPassword}
                  disabled={!pdfPassword || loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {loading ? "Unlocking..." : "Unlock & Parse"}
                </button>
              )}
            </div>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="w-4 h-4 animate-spin text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Parsing PDF...
            </div>
          )}
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
            onChange={handleFileUpload}
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
          No transactions could be parsed. The PDF may be image-based (scanned) or in an unsupported format.
        </p>
      )}
    </div>
  );
}
