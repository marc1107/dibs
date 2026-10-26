# Decisions

Decisions taken during the initial implementation, where the spec or the mockup left room or contradicted each other. Each entry says what was decided and why, so it can be revisited.

## Product rules

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Repeat options | Only *Nie*, *Wöchentlich*, *Alle 2 Wochen* | The spec lists exactly these; the mockup also showed *Täglich* and *Monatlich*. Daily is a range, monthly is rare for a car. |
| 2 | Overlap with one's own booking | Not a conflict; both bookings stay active | Asking yourself makes no sense; the admin booking for someone overlapping that person's own booking behaves the same. |
| 3 | Request covers the *start* of the first booking | First booking starts later ("trimStart") | The spec describes shorten/split/cancel; this is the missing symmetric case. |
| 4 | "Brauch's bis X" later than the own end | Allowed (+15 chips); the first booking is extended to X if no third booking is in the way, otherwise 409 | The mockup has +15 next to the own end; extending silently into a third person's booking would overwrite them. |
| 5 | "Brauch's bis X" range | X must leave the requester at least 15 minutes; default is the own end | X at or after the requested end would mean "no", which is the decline button. |
| 6 | Slot taken while a request was pending | When the request is granted, the new overlap gets its own request instead of activating | Keeps the invariant "never two overlapping active bookings of different people". |
| 7 | Decline with several sub-requests | The booking is rejected, its other open sub-requests are withdrawn | A booking that needs everyone's OK cannot become active after one "Nein". |
| 8 | Withdrawing after a counter offer | Cancels the (already active) booking, or ends it early if it is running | Spec: "kann zurückziehen". The first booker's change from the counter is not rolled back (they agreed to it). |
| 9 | Editing an active booking onto someone else's time | Refused (409) with the hint to book the extra time separately | Turning half of an existing booking back into a request would be confusing; a separate booking uses the normal request flow. |
| 10 | Cancelling a running booking | Stored as "vorzeitig beendet" at the current minute | Same as the sync rule in the spec; nothing is lost. |
| 11 | Removing a member | Future bookings are cancelled (past ones stay in the history) | Otherwise the car would stay blocked by someone without access. |
| 12 | Rejecting a pending person | Status `removed` (not deleted); can be approved later | Prevents the same account from re-triggering approval requests; mistakes are reversible. |
| 13 | First admin | The Google account whose e-mail equals the `ADMIN_EMAIL` secret becomes admin and active on first sign-in | No bootstrap script needed; e-mail stays out of the public repo. |
| 14 | Reminder time | 60 min before timed bookings, 19:00 the evening before all-day bookings, each booking once | A reminder at 23:00 for an all-day booking would be useless. |
| 15 | Pending page text | "schau einfach später wieder rein" instead of a push promise; the page polls every 15 s | Pending people have not allowed push yet (the spec asks for the permission only after approval). |
| 16 | Names and colours | From the Google profile, editable display name in the settings; colours assigned in order from a fixed palette | Resolves the open point without extra admin work. |
| 17 | iCal default | All bookings, per-person toggle "Nur meine Buchungen" | Resolves the open point; the toggle only changes the URL (`?scope=mine`). |

## Technical

| # | Topic | Decision | Why |
|---|---|---|---|
| 18 | Atomic overlap check | Insert as `requested`, flip to `active` and create requests in the same D1 batch (`json_each` for bulk rows) | D1 has no interactive transactions; a batch is one transaction and needs only ~5 statements even for a 50-week series (D1 free-plan query limits). |
| 19 | Idempotency | Generic `client_action` table keyed by the client UUID, used by REST and sync | The spec asks for `client_id` on bookings; edits and cancellations need idempotency too. Replays by a different user are refused. |
| 20 | One write path in the client | All booking mutations go through the outbox, also online | One tested path, offline and online behave the same; the audit source still distinguishes `online` and `offline-sync` (`queuedOffline`). |
| 21 | Offline-only actions | Answering requests, withdrawing and admin actions need a connection | They act on other people's bookings; doing them blind would produce surprising results. |
| 22 | Extra endpoints | `GET /api/users`, `GET /api/bookings/:id`, `GET /api/requests/:id`, `GET /api/history`, `POST /api/push/unsubscribe`, `GET /api/config`, `GET /api/health`, `POST /api/dev/login` (localhost only) | Needed by the screens, the smoke test and the tests. |
| 23 | Extra columns | `booking.timezone`, `booking.reminder_sent_at`, `series.start_local/end_local` as `YYYY-MM-DDTHH:mm` | "UTC plus time zone" from the spec; reminders must be sent once. |
| 24 | Local and test sign-in | `/api/dev/login` behind `DEV_LOGIN=true` **and** a localhost check | Google OAuth cannot run in CI; E2E and integration tests still go through real sessions and cookies. |
| 25 | Turnstile scope | Required for `/sign-in/social`; passkey sign-in does not need it | Passkeys are already phishing- and bot-resistant; Turnstile on every passkey ceremony would only add friction. |
| 26 | Rate limiting | Workers Rate Limiting binding (30/min per IP) on `/api/auth/*`; Better Auth's in-memory limiter disabled | Isolate memory is not shared between requests on Workers. |
| 27 | Web Push library | `@pushforge/builder` (Web Crypto, no Node APIs) | `web-push` does not run on Workers. |
| 28 | Backup format | Weekly JSON export of business tables to R2 (12 kept); sessions, OAuth accounts and verification rows excluded | D1 has no export binding; tokens do not belong in backups; D1 Time Travel covers point-in-time restore. |
| 29 | Cache lifetime | 14 days for the persisted query cache | Values above ~24.8 days overflow `setTimeout` and make TanStack Query garbage-collect restored data immediately (found while testing the offline start). |
| 30 | Data freshness | `staleTime: 0`; cached data is shown at once and revalidated, an incoming push refreshes open windows | In a shared calendar the others' changes must be visible when the app opens. |
| 31 | Version pins | TypeScript 6.0 (typescript-eslint does not support 7 yet); everything else latest | Dependabot proposes the bump once supported. |
| 32 | E2E tool | Playwright, as required by the spec's `ci.yml` | Manual browser checks during development were done with Claude in Chrome / the app browser. |
| 33 | PR previews | Separate Worker `schluesselbrett-preview` with its own D1, no cron | Previews never touch production data. Google sign-in works only on URLs registered in the OAuth client, so previews are mainly for build/deploy and UI checks. |
| 34 | Admin e-mail and VAPID subject | `ADMIN_EMAIL` is a secret; `VAPID_SUBJECT` is the app URL | The repository is public. |
| 35 | Security-fix workflow | Collects CodeQL alerts, `pnpm audit` and (with an optional PAT) Dependabot alerts, then runs Claude Code | `GITHUB_TOKEN` cannot read Dependabot alerts; PRs must come from the Claude GitHub App so CI runs on them. |
| 36 | Dependency overrides | `pnpm.overrides` lift `zod`, `undici` and the `esbuild` used by `@esbuild-kit` (drizzle-kit) to patched versions | Advisories in transitive dev tooling (Cloudflare test/vite plugins, drizzle-kit); CI fails on high findings. Remove an override once the upstream package ships the fix. |
| 37 | Action pinning | Third-party actions are pinned to commit SHAs (with the version as comment, Dependabot keeps them current); GitHub's own actions use major tags | CodeQL "unpinned tag" finding; tags of third-party actions are mutable. |
| 38 | Deploy/preview gate | Both workflows only run when the repository variable `CLOUDFLARE_CONFIGURED` is `true` | Before the Cloudflare setup they would fail on every PR and merge. |
