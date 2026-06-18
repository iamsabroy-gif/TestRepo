import { Transaction } from "./types";
import { createClient } from "./supabase/client";

const supabase = createClient();

export async function getTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false });

  if (error) {
    console.error("Error fetching transactions:", error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    type: row.type as Transaction["type"],
    amount: Number(row.amount),
    currency: row.currency as Transaction["currency"],
    category: row.category as Transaction["category"],
    description: row.description,
    date: row.date,
  }));
}

export async function addTransaction(transaction: Transaction): Promise<Transaction[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return getTransactions();

  const { error } = await supabase.from("transactions").insert({
    id: transaction.id,
    user_id: user.id,
    type: transaction.type,
    amount: transaction.amount,
    currency: transaction.currency,
    category: transaction.category,
    description: transaction.description,
    date: transaction.date,
  });

  if (error) console.error("Error adding transaction:", error);
  return getTransactions();
}

export async function addTransactions(transactions: Transaction[]): Promise<Transaction[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return getTransactions();

  const rows = transactions.map((t) => ({
    id: t.id,
    user_id: user.id,
    type: t.type,
    amount: t.amount,
    currency: t.currency,
    category: t.category,
    description: t.description,
    date: t.date,
  }));

  const { error } = await supabase.from("transactions").insert(rows);
  if (error) console.error("Error adding transactions:", error);
  return getTransactions();
}

export async function deleteTransaction(id: string): Promise<Transaction[]> {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) console.error("Error deleting transaction:", error);
  return getTransactions();
}
