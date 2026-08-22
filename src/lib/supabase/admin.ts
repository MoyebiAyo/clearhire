import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. SERVER ONLY (enforced by the
 * `server-only` import). Used exclusively inside authenticated API routes
 * for cross-cutting writes: storage uploads to the private `cvs` bucket and
 * candidate/application upserts where the duplicate check needs to see
 * candidates with no application yet.
 *
 * Never import this from a client component. Never expose its key.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
