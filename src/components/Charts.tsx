"use client";

import { Transaction } from "@/lib/types";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, type TooltipProps } from "recharts";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4", "#e11d48"];

const CATEGORY_LABELS: Record<string, string> = {
  salary: "Salary",
  freelance: "Freelance",
  investment: "Investment",
  food: "Food",
  transport: "Transport",
  housing: "Housing",
  utilities: "Utilities",
  entertainment: "Entertainment",
  healthcare: "Healthcare",
  shopping: "Shopping",
  education: "Education",
  other: "Other",
};

interface Props {
  transactions: Transaction[];
}

export default function Charts({ transactions }: Props) {
  const expenses = transactions.filter((t) => t.type === "expense");
  const incomes = transactions.filter((t) => t.type === "income");

  const categoryData = Object.entries(
    expenses.reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + t.amount;
      return acc;
    }, {})
  )
    .map(([name, value]) => ({ name: CATEGORY_LABELS[name] || name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);

  const dailyMap = new Map<string, { income: number; expense: number }>();
  for (const t of transactions) {
    const day = t.date.substring(8, 10);
    const entry = dailyMap.get(day) || { income: 0, expense: 0 };
    if (t.type === "income") entry.income += t.amount;
    else entry.expense += t.amount;
    dailyMap.set(day, entry);
  }
  const dailyData = Array.from(dailyMap.entries())
    .map(([day, data]) => ({
      day,
      Income: Math.round(data.income * 100) / 100,
      Expense: Math.round(data.expense * 100) / 100,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);

  if (transactions.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <p className="text-gray-400 text-sm">Add transactions to see charts</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Total Income</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            ${totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Total Expenses</p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            ${totalExpense.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Net Balance</p>
          <p className={`text-2xl font-bold mt-1 ${totalIncome - totalExpense >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            ${(totalIncome - totalExpense).toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {categoryData.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Expenses by Category</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  paddingAngle={2}
                >
                  {categoryData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {dailyData.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Daily Income vs Expenses</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
                <Legend />
                <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
