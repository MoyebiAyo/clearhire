import { NextResponse } from "next/server";

/**
 * GET /api/gmail/connect — starts the Google OAuth flow with MINIMUM scope
 * (gmail.readonly + gmail.labels — never full mailbox write access).
 * Requires GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.
 */
export async function GET(request: Request) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GMAIL_CLIENT_ID isn't configured — create a Google Cloud OAuth client (see RUNNING_NOTES)." },
      { status: 503 }
    );
  }
  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/gmail/callback`,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.labels",
    ].join(" "),
  });
  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
