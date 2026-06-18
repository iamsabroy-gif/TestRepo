import { Currency } from "./types";

const STORAGE_KEY = "expense-tracker-currency";

export function getCurrency(): Currency {
  if (typeof window === "undefined") return "INR";
  return (localStorage.getItem(STORAGE_KEY) as Currency) || "INR";
}

export function setCurrency(currency: Currency) {
  localStorage.setItem(STORAGE_KEY, currency);
}

export function formatAmount(amount: number, currency: Currency = "INR"): string {
  if (currency === "INR") {
    return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
