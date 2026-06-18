import { Transaction } from "./types";

const STORAGE_KEY = "expense-tracker-transactions";

export function getTransactions(): Transaction[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveTransactions(transactions: Transaction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

export function addTransaction(transaction: Transaction) {
  const transactions = getTransactions();
  transactions.push(transaction);
  saveTransactions(transactions);
  return transactions;
}

export function deleteTransaction(id: string) {
  const transactions = getTransactions().filter((t) => t.id !== id);
  saveTransactions(transactions);
  return transactions;
}

export function getTransactionsByMonth(month: string): Transaction[] {
  return getTransactions().filter((t) => t.date.startsWith(month));
}
