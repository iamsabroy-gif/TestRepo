"use client";

import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Transaction, TransactionType, Category, Currency } from "@/lib/types";
import { getCurrency } from "@/lib/currency";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "freelance", label: "Freelance" },
  { value: "investment", label: "Investment" },
  { value: "food", label: "Food & Dining" },
  { value: "transport", label: "Transport" },
  { value: "housing", label: "Housing & Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "entertainment", label: "Entertainment" },
  { value: "healthcare", label: "Healthcare" },
  { value: "shopping", label: "Shopping" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
];

interface Props {
  onAdd: (transaction: Transaction) => void;
}

export default function AddTransaction({ onAdd }: Props) {
  const [type, setType] = useState<TransactionType>("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("food");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;

    const transaction: Transaction = {
      id: uuidv4(),
      type,
      amount: parseFloat(amount),
      currency: getCurrency(),
      category,
      description,
      date,
    };

    onAdd(transaction);
    setAmount("");
    setDescription("");
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Add Transaction</h2>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setType("income")}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            type === "income" ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Income
        </button>
        <button
          type="button"
          onClick={() => setType("expense")}
          className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            type === "expense" ? "bg-red-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Expense
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">Amount</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-800"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-800"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was this for?"
          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-800"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-800"
          required
        />
      </div>

      <button
        type="submit"
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        Add {type === "income" ? "Income" : "Expense"}
      </button>
    </form>
  );
}
