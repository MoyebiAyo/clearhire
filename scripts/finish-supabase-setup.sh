#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ClearHire — finish Supabase + Vercel setup in one command.
#
# Run this AFTER freeing a Supabase project slot (pause/delete one project,
# or upgrade the org — your account hit the 2-active-free-project cap).
# On Windows, run from Git Bash in the repo root:
#   bash scripts/finish-supabase-setup.sh
#
# Optional overrides:
#   SUPABASE_ORG_ID  (default: Mouse Technologies hehuolszsbynwduqzrbh)
#   SUPABASE_REGION  (default: eu-west-3)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ORG_ID="${SUPABASE_ORG_ID:-hehuolszsbynwduqzrbh}"
REGION="${SUPABASE_REGION:-eu-west-3}"
NAME="clearhire"
VURL="https://clearhire-rho.vercel.app"

py() { python -c "$1"; }

# 1. Create the project (reuses the password already saved in
#    .supabase-local.txt if present, else generates one).
PW="$(grep -oP '(?<=SUPABASE_DB_PASSWORD=).*' .supabase-local.txt 2>/dev/null || openssl rand -hex 20)"
printf 'SUPABASE_DB_PASSWORD=%s\n' "$PW" > .supabase-local.txt

echo "▸ Creating Supabase project \"$NAME\" (org $ORG_ID, $REGION)…"
REF="$(supabase projects create "$NAME" --org-id "$ORG_ID" --db-password "$PW" --region "$REGION" -o json | py 'import json,sys; print(json.load(sys.stdin)["id"])')"
echo "  Project ref: $REF"

# 2. Wait until the project is healthy (typically 1–3 minutes).
echo "▸ Waiting for the project to come up…"
for i in $(seq 1 40); do
  STATUS="$(supabase projects list -o json | py "import json,sys; print(next((p['status'] for p in json.load(sys.stdin) if p['id']=='$REF'),''))")"
  [ "$STATUS" = "ACTIVE_HEALTHY" ] && break
  sleep 10
done
if [ "${STATUS:-}" != "ACTIVE_HEALTHY" ]; then
  echo "✗ Project still not healthy after ~6 min (status: ${STATUS:-unknown}). Re-run this script after it finishes initializing — it is safe to abort now." >&2
  exit 1
fi

# 3. Apply the schema (all 11 tables + RLS + trigger + private cvs bucket).
echo "▸ Applying migration…"
supabase link --project-ref "$REF"
supabase db push

# 4. Fetch API keys and write .env.local (gitignored).
echo "▸ Writing .env.local…"
URL="https://${REF}.supabase.co"
KEYS="$(supabase projects api-keys --project-ref "$REF" -o json)"
ANON="$(printf '%s' "$KEYS" | py '
import json,sys
data=json.load(sys.stdin)
keys=data.get("keys",data) if isinstance(data,dict) else data
print(next(k.get("api_key") or k.get("key") for k in keys if "anon" in k.get("name","")))')
SROLE="$(printf '%s' "$KEYS" | py '
import json,sys
data=json.load(sys.stdin)
keys=data.get("keys",data) if isinstance(data,dict) else data
print(next(k.get("api_key") or k.get("key") for k in keys if "service_role" in k.get("name","")))')"
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SROLE
EOF
echo "  .env.local written (DB password saved in .supabase-local.txt)"

# 5. Set Vercel env vars (the stray VERCEL_PROJECT_ID from your shell profile
#    must be unset, or the CLI targets the wrong project) and redeploy.
echo "▸ Setting Vercel env vars + redeploying…"
vset() { printf '%s' "$2" | env -u VERCEL_PROJECT_ID -u VERCEL_ORG_ID vercel env add "$1" production preview 2>/dev/null || printf '%s' "$2" | env -u VERCEL_PROJECT_ID -u VERCEL_ORG_ID vercel env add "$1" production; }
vset NEXT_PUBLIC_SUPABASE_URL "$URL"
vset NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON"
vset SUPABASE_SERVICE_ROLE_KEY "$SROLE"
env -u VERCEL_PROJECT_ID -u VERCEL_ORG_ID vercel deploy --prod --yes

echo ""
echo "✓ Done. Live at $VURL"
echo "  NOTE (optional): for instant signups during development, disable"
echo "  Authentication → Providers → Email → \"Confirm email\" in the Supabase"
echo "  dashboard. The app handles either state gracefully."
