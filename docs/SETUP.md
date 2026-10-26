# Setup: what you still have to fill in

Everything that can be done without your accounts is done. This page lists the remaining steps in order. Estimated time: 45–60 minutes.

## Overview of placeholders

| Where | Placeholder | Value |
|---|---|---|
| `wrangler.jsonc` → `routes[0].pattern` | `REPLACE_WITH_YOUR_DOMAIN` | e.g. `auto.example.com` |
| `wrangler.jsonc` → `vars.APP_URL`, `vars.VAPID_SUBJECT` | `https://REPLACE_WITH_YOUR_DOMAIN` | `https://auto.example.com` |
| `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY` (twice) | `REPLACE_WITH_TURNSTILE_SITE_KEY` | Turnstile site key (step 4) |
| `wrangler.jsonc` → `vars.VAPID_PUBLIC_KEY` (twice) | `REPLACE_WITH_VAPID_PUBLIC_KEY` | public key from `pnpm vapid` (step 5) |
| `wrangler.jsonc` → `d1_databases[0].database_id` | `REPLACE_WITH_D1_DATABASE_ID` | from `wrangler d1 create` (step 2) |
| `wrangler.jsonc` → `env.preview.d1_databases[0].database_id` | `REPLACE_WITH_PREVIEW_D1_DATABASE_ID` | from `wrangler d1 create` (step 2) |
| `wrangler.jsonc` → `env.preview.vars.APP_URL` | `REPLACE_WITH_WORKERS_SUBDOMAIN` | your `*.workers.dev` subdomain (Cloudflare dashboard → Workers) |
| Worker secrets (`wrangler secret put`) | – | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`, `TURNSTILE_SECRET_KEY`, `ADMIN_EMAIL` |
| GitHub → Settings → Secrets → Actions | – | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY` *or* `CLAUDE_CODE_OAUTH_TOKEN`, optional `SECURITY_ALERTS_TOKEN` |
| GitHub → Settings → Variables → Actions | – | `APP_URL` = `https://auto.example.com` (smoke test) |

All values in `wrangler.jsonc` are public (the repository is public). Everything secret goes into Worker secrets or GitHub secrets only. `grep -rn REPLACE_ wrangler.jsonc` shows what is still open.

## 1. Domain on Cloudflare

1. Add your domain to Cloudflare (Websites → Add a site, free plan) and switch the nameservers at your registrar, if it is not there yet.
2. Pick a subdomain, e.g. `auto.example.com`. Nothing else to configure: `wrangler deploy` creates the DNS record and certificate because of `"custom_domain": true`.

## 2. Cloudflare resources

```bash
pnpm exec wrangler login
./scripts/setup-cloudflare.sh
```

The script creates the D1 databases `schluesselbrett` and `schluesselbrett-preview` and the private R2 bucket `schluesselbrett-backups`, then (after you confirm that `wrangler.jsonc` is filled in) asks for every Worker secret and applies the migrations. Copy the printed `database_id` values into `wrangler.jsonc`.

**Cloudflare API token for GitHub Actions:** dashboard → My Profile → API Tokens → Create Token → template *Edit Cloudflare Workers*, then add **Account · D1 · Edit**. Restrict it to your account and zone. Save as GitHub secret `CLOUDFLARE_API_TOKEN`; the account ID (dashboard sidebar) as `CLOUDFLARE_ACCOUNT_ID`.

## 3. Google OAuth client

1. <https://console.cloud.google.com/> → new project "Schlüsselbrett".
2. *APIs & Services → OAuth consent screen*: External, app name "Auto-Kalender", your e-mail. Keep the publishing status **Testing** and add the three Google accounts as **test users** (only they can sign in, which is exactly what we want).
3. *Credentials → Create credentials → OAuth client ID → Web application*:
   - Authorized JavaScript origins: `https://auto.example.com`
   - Authorized redirect URIs: `https://auto.example.com/api/auth/callback/google`
   - Optional for local tests with real Google login: `http://localhost:5173` and `http://localhost:5173/api/auth/callback/google`
4. Client ID → secret `GOOGLE_CLIENT_ID`, client secret → secret `GOOGLE_CLIENT_SECRET`.

## 4. Cloudflare Turnstile

Dashboard → Turnstile → Add widget: hostname `auto.example.com`, mode **Managed** (or Invisible). Site key → `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, secret key → Worker secret `TURNSTILE_SECRET_KEY`.

## 5. Web Push (VAPID)

```bash
pnpm vapid
```

Public key → `VAPID_PUBLIC_KEY` in `wrangler.jsonc` (production and preview). Private key (the JSON line) → Worker secret `VAPID_PRIVATE_KEY`. Do not regenerate later: existing push subscriptions are bound to the key.

## 6. Remaining Worker secrets

- `BETTER_AUTH_SECRET`: `openssl rand -base64 32`
- `ADMIN_EMAIL`: your Google address. This account becomes admin automatically on first sign-in; everyone else starts as *pending*.

## 7. GitHub

1. Secrets and variable from the table above. For `security-fix.yml` either an Anthropic API key (`ANTHROPIC_API_KEY`) or a Claude subscription token (`CLAUDE_CODE_OAUTH_TOKEN`, created with `claude setup-token`). Optional `SECURITY_ALERTS_TOKEN`: a fine-grained PAT for this repository with *Dependabot alerts: read* (the default `GITHUB_TOKEN` cannot read Dependabot alerts; without it the workflow uses CodeQL alerts and `pnpm audit`).
2. Install the Claude GitHub App on the repository (`/install-github-app` in Claude Code). PRs opened with the default `GITHUB_TOKEN` would not trigger CI, the app avoids that.
3. Create the environment **production** (Settings → Environments), optionally with yourself as required reviewer if you want to approve each deploy.
4. After this first PR is merged (so the check names `ci` and `codeql` exist), run:

   ```bash
   ./scripts/setup-github.sh
   ```

   It enables auto-merge, branch deletion after merge, squash-only merges, Dependabot alerts and security updates, secret scanning with push protection, and the ruleset on `main` (PR only, required checks `ci` + `codeql`, no force push, no deletion).

## 8. First deploy

Merge to `main` (or run the *deploy* workflow manually). `deploy.yml` applies the migrations, deploys the Worker and runs a smoke test against `APP_URL`.

## 9. On each iPhone

1. Open `https://auto.example.com` in **Safari** → Share → **Add to Home Screen**.
2. Open the app from the Home Screen and sign in **there** (the installed app has its own cookies, separate from Safari).
3. Admin: approve the others under *Verwaltung* (you get a push once you allowed notifications).
4. After approval: tap **Face ID einrichten** and **Mitteilungen erlauben** on the start screen. From then on Face ID is enough.
5. Optional: *Einstellungen → Kalender-Abo → Abonnieren* adds the bookings to the iPhone calendar.

## Open points from the spec, resolved by default

| Open point | Default chosen | How to change |
|---|---|---|
| Names and colours | Taken from the Google profile; colours assigned in order (blue, orange, teal, …). Everyone can change their display name in *Einstellungen*. | Colours: `PALETTE` in `src/shared/constants.ts` |
| Domain | Placeholder, see table above | `wrangler.jsonc` |
| iCal: all or own bookings | **All bookings** by default; "Nur meine Buchungen" toggle per person (adds `?scope=mine`) | – |
| Key for the security-fix workflow | Supports both API key and subscription token | GitHub secrets |
