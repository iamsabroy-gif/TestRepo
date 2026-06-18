"use client";

import { Transaction } from "@/lib/types";
import { format } from "date-fns";

const CATEGORY_LABELS: Record<string, string> = {
  salary: "Salary",
  freelance: "Freelance",
  investment: "Investment",
  food: "Food & Dining",
  transport: "Transport",
  housing: "Housing & Rent",
  utilities: "Utilities",
  entertainment: "Entertainment",
  healthcare: "Healthcare",
  shopping: "Shopping",
  education: "Education",
  other: "Other",
};

interface Props {
  transactions: Transaction[];
  onDelete: (id: string) => void;
}

export default function TransactionList({ transactions, onDelete }: Props) {
  const sorted = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (sorted.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <p className="text-gray-400 text-sm">No transactions yet. Add one to get started!</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-800">Transactions</h2>
      </div>
      <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
        {sorted.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${t.type === "income" ? "bg-emerald-500" : "bg-red-500"}`}
                />
                <p className="text-sm font-medium text-gray-800 truncate">
                  {t.description || CATEGORY_LABELS[t.category] || t.category}
                </p>
              </div>
              <p className="text-xs text-gray-400 mt-0.5 ml-4">
                {CATEGORY_LABELS[t.category]} &middot; {format(new Date(t.date), "MMM d, yyyy")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-semibold ${t.type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                {t.type === "income" ? "+" : "-"}${t.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
              <button
                onClick={() => onDelete(t.id)}
                className="text-gray-300 hover:text-red-500 transition-colors p-1"
                title="Delete"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
