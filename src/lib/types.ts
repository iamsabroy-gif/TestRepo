export type TransactionType = "income" | "expense";

export type Category =
  | "salary"
  | "freelance"
  | "investment"
  | "food"
  | "transport"
  | "housing"
  | "utilities"
  | "entertainment"
  | "healthcare"
  | "shopping"
  | "education"
  | "other";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: Category;
  description: string;
  date: string; // ISO date string
}

export interface MonthlyData {
  month: string; // YYYY-MM
  transactions: Transaction[];
}

export interface ParsedStatement {
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
}
