import { Transaction } from "./types";

export const SEED_TRANSACTIONS: Transaction[] = [
  {
    id: "seed-1",
    type: "expense",
    amount: 529.82,
    currency: "INR",
    category: "utilities",
    description: "Jio Mobile Recharge - UPI",
    date: "2026-06-16",
  },
  {
    id: "seed-2",
    type: "expense",
    amount: 1864.82,
    currency: "INR",
    category: "utilities",
    description: "JioHome Fiber - UPI",
    date: "2026-05-31",
  },
  {
    id: "seed-3",
    type: "expense",
    amount: 4999.75,
    currency: "INR",
    category: "investment",
    description: "Kotak Multicap Fund Regular Plan - SIP",
    date: "2026-05-12",
  },
  {
    id: "seed-4",
    type: "income",
    amount: 0.93,
    currency: "INR",
    category: "investment",
    description: "Slice Bank Savings Interest",
    date: "2026-05-31",
  },
];
