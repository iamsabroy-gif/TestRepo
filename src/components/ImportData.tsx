"use client";

import { useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { Transaction, ParsedStatement } from "@/lib/types";
import { parseCSV, parseEmailText } from "@/lib/parser";

interface Props {
  onImport: (transactions: Transaction[]) => void;
}

export default function ImportData({ onImport }: Props) {
  const [mode, setMode] = useState<"csv" | "email">("csv");
  const [emailText, setEmailText] = useState("");
  const [preview, setPreview] = useState<ParsedStatement[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      setPreview(parsed);
      setShowPreview(true);
    };
    reader.readAsText(file);
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
      category: "other",
      description: p.description,
      date: p.date,
    }));
    onImport(transactions);
    setPreview([]);
    setShowPreview(false);
    setEmailText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Import Transactions</h2>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setMode("csv"); setShowPreview(false); }}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === "csv" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Bank Statement (CSV)
        </button>
        <button
          type="button"
          onClick={() => { setMode("email"); setShowPreview(false); }}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            mode === "email" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Email / Text
        </button>
      </div>

      {mode === "csv" ? (
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
      ) : (
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
                  {p.type === "income" ? "+" : "-"}${p.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showPreview && preview.length === 0 && (
        <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
          No transactions could be parsed. Please check your data format.
        </p>
      )}
    </div>
  );
}
