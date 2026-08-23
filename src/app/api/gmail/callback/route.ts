import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/gmail/callback — OAuth redirect target: exchanges the code for a
 * refresh token and stores it ENCRYPTED (pgcrypto) via gmail_store_token.
 * The plaintext token never touches the database or the client.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;
  if (!code) {
    return NextResponse.redirect(`${origin}/settings?gmail=error`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        grant_type: "authorization_code",
        redirect_uri: `${origin}/api/gmail/callback`,
      }),
    });
    const tokens = (await tokenRes.json()) as {
      refresh_token?: string;
      id_token?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tokens.refresh_token) {
      throw new Error(tokens.error ?? "no refresh token returned");
    }

    // Gmail address from the id_token payload (our own consent flow).
    const address = tokens.id_token
      ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64").toString()).email
      : "(unknown)";

    const admin = createAdminClient();
    const { error } = await admin.rpc("gmail_store_token", {
      p_recruiter: user.id,
      p_address: address,
      p_token: tokens.refresh_token,
      p_key: process.env.GMAIL_ENCRYPTION_KEY!,
    });
    if (error) throw new Error(error.message);

    return NextResponse.redirect(`${origin}/settings?gmail=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/settings?gmail=error`);
  }
}
