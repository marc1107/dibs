#!/usr/bin/env bash
# One-time Cloudflare setup. Creates the D1 databases and the R2 bucket, then asks for each
# Worker secret. Run after `pnpm exec wrangler login`. Safe to re-run (existing resources are kept).
set -euo pipefail

echo "== D1 databases (copy the printed database_id values into wrangler.jsonc)"
pnpm exec wrangler d1 create schluesselbrett || echo "(schluesselbrett exists)"
pnpm exec wrangler d1 create schluesselbrett-preview || echo "(schluesselbrett-preview exists)"
pnpm exec wrangler d1 list

echo "== R2 bucket for backups"
pnpm exec wrangler r2 bucket create dibs-backups || echo "(bucket exists)"

read -r -p "Have you replaced all REPLACE_ values in wrangler.jsonc? [y/N] " ok
[[ "$ok" == "y" ]] || { echo "Fill in wrangler.jsonc first, then re-run."; exit 1; }

echo "== Worker secrets (production)"
for name in BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET VAPID_PRIVATE_KEY TURNSTILE_SECRET_KEY ADMIN_EMAIL; do
  echo "-- $name"
  pnpm exec wrangler secret put "$name"
done

read -r -p "Also set secrets for the preview Worker? [y/N] " preview
if [[ "$preview" == "y" ]]; then
  for name in BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET VAPID_PRIVATE_KEY TURNSTILE_SECRET_KEY ADMIN_EMAIL; do
    echo "-- $name (preview)"
    pnpm exec wrangler secret put "$name" --env preview
  done
fi

echo "== Database schema"
pnpm exec wrangler d1 migrations apply DB --remote
echo "Done. Deploy with: pnpm deploy (or merge to main)."
