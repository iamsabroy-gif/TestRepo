import { NextRequest, NextResponse } from "next/server";

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailMessageDetail {
  id: string;
  snippet: string;
  payload: GmailPayload;
}

interface GmailPayload {
  mimeType: string;
  body?: { data?: string; size: number };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

interface GmailPart {
  mimeType: string;
  body?: { data?: string; size: number };
  parts?: GmailPart[];
}

const DEFAULT_QUERY =
  "subject:(transaction OR debit OR credit OR payment OR alert OR statement) newer_than:30d";

function base64urlDecode(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function extractPlainText(payload: GmailPayload): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return base64urlDecode(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainTextFromPart(part);
      if (text) return text;
    }
  }

  // Fallback: if body has data regardless of mime type
  if (payload.body?.data) {
    return base64urlDecode(payload.body.data);
  }

  return "";
}

function extractPlainTextFromPart(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return base64urlDecode(part.body.data);
  }

  if (part.parts) {
    for (const nested of part.parts) {
      const text = extractPlainTextFromPart(nested);
      if (text) return text;
    }
  }

  return "";
}

function extractSubject(payload: GmailPayload): string {
  const subjectHeader = payload.headers?.find(
    (h) => h.name.toLowerCase() === "subject"
  );
  return subjectHeader?.value || "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessToken, query } = body as {
      accessToken: string;
      query?: string;
    };

    if (!accessToken) {
      return NextResponse.json(
        { error: "Access token is required" },
        { status: 400 }
      );
    }

    const searchQuery = query || DEFAULT_QUERY;

    // Search for messages
    const searchUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    );
    searchUrl.searchParams.set("q", searchQuery);
    searchUrl.searchParams.set("maxResults", "20");

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!searchRes.ok) {
      const errData = await searchRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Failed to search Gmail", details: errData },
        { status: searchRes.status }
      );
    }

    const searchData = (await searchRes.json()) as {
      messages?: GmailMessage[];
    };

    if (!searchData.messages || searchData.messages.length === 0) {
      return NextResponse.json({ emails: [] });
    }

    // Fetch each message's details
    const emailPromises = searchData.messages.map(async (msg) => {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
      const msgRes = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!msgRes.ok) return null;

      const msgData = (await msgRes.json()) as GmailMessageDetail;
      const body = extractPlainText(msgData.payload);
      const subject = extractSubject(msgData.payload);

      return {
        id: msgData.id,
        subject,
        snippet: msgData.snippet,
        body,
      };
    });

    const results = await Promise.all(emailPromises);
    const emails = results.filter(Boolean);

    return NextResponse.json({ emails });
  } catch (error) {
    console.error("Gmail API route error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
