"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import { Transaction } from "@/lib/types";
import { getTransactions, saveTransactions, addTransaction as storeAdd, deleteTransaction as storeDel } from "@/lib/store";
import AddTransaction from "@/components/AddTransaction";
import TransactionList from "@/components/TransactionList";
import Charts from "@/components/Charts";
import ImportData from "@/components/ImportData";
import ExportButton from "@/components/ExportButton";
import MonthPicker from "@/components/MonthPicker";

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [activeTab, setActiveTab] = useState<"dashboard" | "add" | "import">("dashboard");
  const reportRef = useRef<HTMLDivElement>(null);

  const monthKey = format(currentMonth, "yyyy-MM");

  useEffect(() => {
    setTransactions(getTransactions());
  }, []);

  const filtered = transactions.filter((t) => t.date.startsWith(monthKey));

  const handleAdd = useCallback((t: Transaction) => {
    const updated = storeAdd(t);
    setTransactions(updated);
    setActiveTab("dashboard");
  }, []);

  const handleDelete = useCallback((id: string) => {
    const updated = storeDel(id);
    setTransactions(updated);
  }, []);

  const handleImport = useCallback((imported: Transaction[]) => {
    const all = [...getTransactions(), ...imported];
    saveTransactions(all);
    setTransactions(all);
    setActiveTab("dashboard");
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-gray-800">ExpenseTracker</h1>
          </div>
          <MonthPicker currentMonth={currentMonth} onChange={setCurrentMonth} />
          <ExportButton targetRef={reportRef} filename={`expenses-${monthKey}`} />
        </div>
      </header>

      <nav className="bg-white border-b border-gray-100 md:hidden">
        <div className="max-w-6xl mx-auto px-4 flex">
          {(["dashboard", "add", "import"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium capitalize transition-colors border-b-2 ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div ref={reportRef} className="space-y-6">
          <div className={`${activeTab !== "dashboard" ? "hidden md:block" : ""}`}>
            <Charts transactions={filtered} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className={`lg:col-span-2 ${activeTab !== "dashboard" ? "hidden md:block" : ""}`}>
              <TransactionList transactions={filtered} onDelete={handleDelete} />
            </div>
            <div className="space-y-6">
              <div className={`${activeTab !== "add" ? "hidden md:block" : ""}`}>
                <AddTransaction onAdd={handleAdd} />
              </div>
              <div className={`${activeTab !== "import" ? "hidden md:block" : ""}`}>
                <ImportData onImport={handleImport} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
