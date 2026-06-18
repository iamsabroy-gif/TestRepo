"use client";

import { useState, useCallback, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Transaction, ParsedStatement } from "@/lib/types";
import { parseEmailText } from "@/lib/parser";
import { getCurrency, formatAmount } from "@/lib/currency";

interface Props {
  onImport: (transactions: Transaction[]) => void;
}

interface GmailEmail {
  id: string;
  subject: string;
  snippet: string;
  body: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

export default function GmailImport({ onImport }: Props) {
  const [gsiLoaded, setGsiLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [emails, setEmails] = useState<GmailEmail[]>([]);
  const [preview, setPreview] = useState<ParsedStatement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"connect" | "fetching" | "preview">("connect");

  // Load Google Identity Services script
  useEffect(() => {
    if (typeof window === "undefined" || !GOOGLE_CLIENT_ID) return;

    if (window.google?.accounts?.oauth2) {
      setGsiLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGsiLoaded(true);
    script.onerror = () => setError("Failed to load Google sign-in library");
    document.head.appendChild(script);

    return () => {
      // Only remove if it's still in the DOM
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  const handleConnect = useCallback(() => {
    if (!window.google?.accounts?.oauth2) {
      setError("Google sign-in library not loaded");
      return;
    }

    setError(null);

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          setError("Authentication failed. Please try again.");
          return;
        }
        if (response.access_token) {
          setAccessToken(response.access_token);
          fetchEmails(response.access_token);
        }
      },
    });

    tokenClient.requestAccessToken();
  }, []);

  async function fetchEmails(token: string) {
    setLoading(true);
    setStep("fetching");
    setError(null);

    try {
      const res = await fetch("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch emails");
      }

      const data = (await res.json()) as { emails: GmailEmail[] };
      setEmails(data.emails);

      // Parse all email bodies for transactions
      const allText = data.emails.map((e) => e.body).join("\n");
      const parsed = parseEmailText(allText);
      setPreview(parsed);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch emails");
      setStep("connect");
    } finally {
      setLoading(false);
    }
  }

  function handleImportAll() {
    const transactions: Transaction[] = preview.map((p) => ({
      id: uuidv4(),
      type: p.type,
      amount: p.amount,
      currency: getCurrency(),
      category: "other",
      description: p.description,
      date: p.date,
    }));
    onImport(transactions);
    setPreview([]);
    setEmails([]);
    setStep("connect");
    setAccessToken(null);
  }

  function handleReset() {
    setPreview([]);
    setEmails([]);
    setStep("connect");
    setAccessToken(null);
    setError(null);
  }

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Gmail Import</h2>
        <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
          Gmail integration is not configured. Set the NEXT_PUBLIC_GOOGLE_CLIENT_ID environment variable to enable it.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Gmail Import</h2>
        {step !== "connect" && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Connect your Gmail to automatically find and import bank transaction alerts.
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>
      )}

      {step === "connect" && (
        <button
          type="button"
          onClick={handleConnect}
          disabled={!gsiLoaded || loading}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20v12zM20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z" />
          </svg>
          {!gsiLoaded ? "Loading..." : "Connect Gmail"}
        </button>
      )}

      {step === "fetching" && (
        <div className="flex items-center justify-center py-6">
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <svg
              className="w-5 h-5 animate-spin text-blue-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Searching for bank emails...
          </div>
        </div>
      )}

      {step === "preview" && preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Found {preview.length} transaction{preview.length !== 1 ? "s" : ""} in{" "}
              {emails.length} email{emails.length !== 1 ? "s" : ""}
            </h3>
            <button
              type="button"
              onClick={handleImportAll}
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
                  {p.type === "income" ? "+" : "-"}{formatAmount(p.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === "preview" && preview.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
            {emails.length === 0
              ? "No bank-related emails found in the last 30 days."
              : `Found ${emails.length} email${emails.length !== 1 ? "s" : ""}, but no transactions could be parsed from them.`}
          </p>
          {accessToken && emails.length === 0 && (
            <button
              type="button"
              onClick={() => fetchEmails(accessToken)}
              className="w-full py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
