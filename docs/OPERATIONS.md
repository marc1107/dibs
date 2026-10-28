# Operations

## Deploys

Every merge to `main` runs `deploy.yml`: build, `wrangler d1 migrations apply DB --remote`, `wrangler deploy`, smoke test against `APP_URL` (health, login page, API answers 401 without session). Pull requests get a preview version (`preview.yml`) on a separate Worker and database, linked in a PR comment.

Manual deploy from a laptop: `pnpm deploy` (needs `wrangler login`).

## Database changes

1. Change `src/worker/db/schema.ts`.
2. `pnpm db:generate` creates a new SQL file in `migrations/`. Review it; D1/SQLite cannot alter every column in place.
3. `pnpm db:apply:local`, run the tests, open a PR. The deploy applies the migration before the new code goes live, so migrations must be backwards compatible with the running version (add columns first, remove them in a later release).

## Backups and restore

- **D1 Time Travel** (built in, 7 days on the free plan): restore to any minute.

  ```bash
  # The D1 database keeps its original name "schluesselbrett" (D1 databases cannot be renamed).
  pnpm exec wrangler d1 time-travel info schluesselbrett
  pnpm exec wrangler d1 time-travel restore schluesselbrett --timestamp=2026-10-26T10:00:00Z
  ```

- **Weekly export to R2** (Sunday 03:00 UTC, last 12 kept) in `dibs-backups/backups/YYYY-MM-DD.json`: one JSON object per table. Download with `pnpm exec wrangler r2 object get dibs-backups/backups/<date>.json --file backup.json --remote`. To restore into an empty database, apply the migrations and insert the rows table by table (users first, then series, booking, request, audit_log). People sign in again with Google afterwards because sessions and OAuth accounts are not part of the export.

## Free-plan limits

Workers: 100,000 requests/day. D1: daily read/write limits; since 1 September 2026 queries fail until midnight UTC once exceeded. Three people stay far below both. Booking creation uses a fixed number of statements regardless of series length, and the calendar loads one month per request.

Check usage in the Cloudflare dashboard (Workers & Pages → dibs → Metrics, Storage & Databases → D1).

## Logs

`pnpm exec wrangler tail` streams live logs. Push errors, failed backups and unexpected errors are logged with `console.warn`/`console.error`; Workers observability is enabled in `wrangler.jsonc`.

## Maintenance automation

| Workflow | When | What |
|---|---|---|
| `ci.yml` | every PR and push to main | lint, typecheck, Vitest, build, `pnpm audit`, Playwright |
| `codeql.yml` | PR, push, weekly | CodeQL (JavaScript/TypeScript and GitHub Actions) |
| `dependabot.yml` | weekly | one grouped PR for npm and one for Actions; security updates as separate PRs |
| `automerge.yml` | Dependabot PRs | enables auto-merge for patch updates (merges once checks are green); minor/major wait for you |
| `security-fix.yml` | weekly, manual | Claude Code fixes open CodeQL/Dependabot/audit findings and opens a PR |

## Rotating secrets

- `BETTER_AUTH_SECRET`: rotating signs everyone out (sessions become invalid); passkeys keep working.
- `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`: rotate in the provider console, then `wrangler secret put`.
- VAPID keys: rotating invalidates all push subscriptions; everyone has to allow notifications again.
- iCal links: each person can regenerate theirs in the settings.
