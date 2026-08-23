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
      access_token?: string;
      id_token?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tokens.refresh_token) {
      throw new Error(tokens.error ?? "no refresh token returned");
    }

    // We request only Gmail scopes (no openid/email), so Google sends no
    // id_token — get the address from Gmail's own profile endpoint instead.
    let address = "(unknown)";
    try {
      const profileRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as { emailAddress?: string };
        if (profile.emailAddress) address = profile.emailAddress;
      }
    } catch {
      // address stays "(unknown)" — connection still works without it
    }

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
