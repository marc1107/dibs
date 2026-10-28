# Architecture

One Cloudflare Worker serves everything on one origin: the PWA's static assets, the JSON API under `/api`, Better Auth under `/api/auth`, and the iCal feed under `/ical`. The iPhone only talks to the Worker; Google is only involved in the first sign-in.

```
iPhone (installed PWA)
  ├─ Service worker: precached app shell, push + notification click
  ├─ TanStack Query cache ──persisted──▶ IndexedDB ("Offline · Stand 07:42")
  └─ Outbox (IndexedDB) ──POST /api/sync──┐
                                          ▼
Cloudflare Worker (Hono)
  ├─ static assets (public/_headers: CSP, HSTS …)      run_worker_first: /api/*, /ical/*
  ├─ /api/auth/*  Better Auth (Google, passkeys, Turnstile) behind Workers Rate Limiting
  ├─ /api/*       session → status = active → role/owner checks per endpoint
  ├─ /ical/:token.ics
  └─ cron: */15 reminders, Sunday 03:00 UTC backup → R2
        │
        ▼
D1 (SQLite via Drizzle)          R2 (weekly JSON export)
```

## Repository layout

```
src/shared/     Pure domain code used by client and worker
  time.ts         Berlin wall-clock ⇄ UTC, intervals, German formatting
  series.ts       expands a booking/series into concrete occurrences
  resolution.ts   effect of "Klar, nimm's" / "Brauch's bis X" on the first booking
  schemas.ts      Zod schemas (single source of validation for client and worker)
  api.ts          JSON types of the API
  constants.ts    statuses, notification types and defaults, colour palette
src/worker/     Cloudflare Worker
  index.ts        Hono app, middleware order, cron handler
  auth.ts         Better Auth configuration and database hooks
  db/schema.ts    Drizzle schema (source of the SQL migrations in migrations/)
  services/       business logic (bookings, requests, users, ical, push, reminders, backup)
  routes/         thin HTTP layer: validate → service → JSON
  middleware/     session/status/role checks, rate limit
src/client/     React PWA
  pages/          screens from the mockup
  components/     calendar views, reserve sheet, UI kit
  lib/            API client, outbox, cache overlay, push, service worker registration
test/           Worker integration tests (Vitest inside workerd with real local D1)
e2e/            Playwright tests (iPhone viewport + passkey test in Chromium)
```

## Data model

All instants are stored as UTC ISO strings (`2026-10-28T16:00:00.000Z`), which sort correctly as text; every booking also stores its time zone (`Europe/Berlin`). Display and all-day logic use Berlin wall-clock time, so a weekly 17:00 slot stays at 17:00 across DST changes and an all-day booking is 00:00–24:00 local time (23 or 25 hours on switch days).

| Table | Purpose | Notes |
|---|---|---|
| `user` | Better Auth user + `role`, `status`, `color`, `start_view`, `ical_token` | app fields are `input: false`, clients can never set them |
| `session`, `account`, `verification`, `passkey` | Better Auth | |
| `series` | a weekly/biweekly reservation | `start_local`/`end_local` in Berlin time, `until_date`; split into a new series on "dieser und alle folgenden" |
| `booking` | every single booking, series occurrences materialised | keeps `original_starts_at/ends_at` forever; `client_id` unique (idempotency); `reminder_sent_at` |
| `request` | overlap request from `booking_id` (new) to `target_booking_id` (first) | partial unique index: at most one *open* request per pair |
| `audit_log` | every change, with before/after JSON and source `online` / `offline-sync` / `admin` | |
| `push_subscription` | Web Push endpoint per device | removed automatically on 404/410 |
| `notification_pref` | per user and type | missing row = default from `NOTIFICATION_DEFAULTS` |
| `client_action` | idempotency store: result of every mutation by client UUID | replays return the stored result |

Indexes: `booking(starts_at, ends_at)`, `booking(owner_id)`, `booking(series_id)`, `request(booking_id)`, `request(target_booking_id)`, `audit_log(at)`, `audit_log(booking_id)`.

## Booking rules

**Overlap** means `b.starts_at < new.ends_at AND b.ends_at > new.starts_at` with another person's *active* booking. Touching bookings do not overlap. Overlaps with one's own bookings are ignored.

**Creating** (`createBooking`) runs as one D1 batch, which D1 executes as a single transaction:

1. insert all occurrences as `requested` (one statement via `json_each`),
2. flip to `active` every occurrence that no other active booking overlaps,
3. create an open request for each remaining overlap,
4. write the audit entries.

Because the overlap check and the insert happen in the same transaction, two people booking the same slot at the same moment can never both end up active; the later one (by server receive time) becomes a request. A series where one occurrence collides creates exactly one request for that occurrence; the rest is active.

**Activation** (`tryActivate`): a requested booking becomes active once no request is open and no other active booking overlaps. Before flipping, requests whose target no longer overlaps (cancelled, ended early, shortened) are resolved automatically, and new overlaps that appeared in the meantime get a new request. It runs after every answer and whenever a booking that others wait for is cancelled, ended early or shortened.

**Answers** (`respond`), by the first booker or the admin:

| Answer | Effect on the first booking | Effect on the request(er) |
|---|---|---|
| Klar, nimm's | shortened to the start of the request, trimmed at the start, split in two, or cancelled if fully covered (`grantEffect`) | request `granted`, booking activated once all parts are resolved |
| Brauch's bis X | extended to X if X is later than its end, then cut like above relative to the shifted request | request `partial` with `counter_time`, requester starts at X and is confirmed; can still withdraw |
| Nein, brauche es | unchanged | request `declined`, booking `rejected`, its other open sub-requests `withdrawn` |

Requests never expire. Withdrawing cancels the requesting booking (or ends it early if it is already running) and withdraws all its requests.

**Editing** an *active* booking onto someone else's time is refused with 409 (create a separate booking for the extra time, which becomes a request). Editing a *requested* booking withdraws its open requests and asks again for the new times. "Dieser und alle folgenden" applies the new wall-clock times (and a day shift) to this and every later occurrence and splits the series.

**Cancelling**: before the start → `cancelled`; while running → `ended_early` at the current minute; already over → ignored and reported. **Jetzt zurückgeben** sets the end to now (`ended_early`), the calendar shows the rest grey striped "frei ab 15:20".

## Offline and sync

- The service worker precaches the app shell; navigation falls back to `index.html`.
- The TanStack Query cache is persisted to IndexedDB (14 days; must stay below the 24.8-day `setTimeout` limit). The app does not render queries before the cache is restored, so a cold offline start shows the last data.
- Every booking mutation (create, edit, cancel, end now) goes through the **outbox**: stored in IndexedDB, applied locally at once (`applyOutbox`, marked "wird gesendet"), then sent in order via `POST /api/sync`. Each action carries a client UUID; the server stores the result per UUID, so resending never creates duplicates.
- Sending happens on start, when the app comes to the foreground, when the browser reports `online`, every 30 s while something is queued, and via the "Senden" button. Safari has no Background Sync, so the banner "1 Buchung noch nicht gesendet" stays visible until it is sent.
- Conflicts follow the server: a queued booking whose slot is taken becomes a normal request; an edit of a booking that changed in the meantime (`baseUpdatedAt` mismatch) is rejected as `stale` and the app shows before/after with "Erneut bearbeiten"; cancelling something that is already over is ignored and reported.
- Each action gets its own result. A malformed action is rejected alone (`invalid`); an unexpected server error stops the batch at that action (`server`, nothing of it stored) and the app retries it with growing delay, dropping it with a message after three failures.
- Answering requests and admin actions need a connection (they are disabled offline).

## Notifications

| Type | Recipients | Default | Can be switched off |
|---|---|---|---|
| `approval_request` | admins | on | no |
| `request_to_me` | first booker | on | no |
| `request_answer` | requester (also when a waiting request gets activated) | on | yes |
| `new_booking` | everyone except owner and actor | on | yes |
| `booking_changed` | owner, when someone else (admin) changes/cancels it; first bookers when a request is withdrawn | on | yes |
| `reminder` | owner, 60 min before timed bookings, 19:00 the evening before all-day bookings | off | yes |

Notifications are collected during a request and sent after the response (`waitUntil`) with VAPID from the Worker (`@pushforge/builder`). Without VAPID keys (local dev) they are logged instead. A notification tap opens the matching screen; an incoming push refreshes open app windows.

## Security

- Every endpoint except `/api/auth/*`, `/api/health`, `/api/config` and `/ical/*` needs a session; everything except `/api/me` additionally needs `status = active` (pending people get 403). Role and ownership are checked in the services, the UI only hides buttons. Integration tests cover each rule of the permission table.
- Removed people: sessions, passkeys and push subscriptions are deleted, the iCal token is revoked, future bookings are cancelled, and a database hook refuses to create new sessions for them (also via Google).
- Sessions: httpOnly, Secure, SameSite=Lax cookies, 30 days sliding.
- Input validation with the shared Zod schemas; all SQL through Drizzle with bound parameters (raw SQL only via the `sql` template, never string concatenation of input).
- Rate limiting on `/api/auth/*` (Workers Rate Limiting, 30/min per IP); Turnstile on Google sign-in.
- Headers: strict CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` (`public/_headers` for assets, `secureHeaders` for Worker responses).
- iCal: 32-byte random token, read-only, regenerable; the feed contains names, times and notes only.
- `/api/dev/login` exists for local development and tests only: it answers 404 unless `DEV_LOGIN=true` **and** the request goes to `localhost`/`127.0.0.1`. `DEV_LOGIN` is never set in production.

## API

REST under `/api`, JSON, session cookie. Validation schemas in `src/shared/schemas.ts`, response types in `src/shared/api.ts`.

| Method & path | Who | Purpose |
|---|---|---|
| `/api/auth/*` | all | Better Auth: Google OAuth, passkeys, session, sign-out |
| `GET /api/health`, `GET /api/config` | all | health check, public Turnstile site key |
| `GET /api/me` | signed in | own profile, role, status, notification settings, iCal URL |
| `GET /api/users` | member | active members (and removed ones, for names in the history) |
| `GET /api/bookings?from&to` | member | bookings in the range plus related requests |
| `POST /api/bookings` | member | booking or series; `ownerId` admin only; 201 created / 202 became a request |
| `GET /api/bookings/:id` | member | booking with incoming and outgoing requests |
| `PATCH /api/bookings/:id` | owner, admin | change times/note, `scope=this\|following`, optional `baseUpdatedAt` |
| `POST /api/bookings/:id/cancel` | owner, admin | cancel, `scope=this\|following` |
| `POST /api/bookings/:id/end-now` | owner, admin | return the car now |
| `GET /api/history` | member | own bookings (all statuses) and their audit entries |
| `GET /api/requests` | member | open requests to me, from me, and (admin) between others |
| `GET /api/requests/:id` | member | one request with both bookings |
| `POST /api/requests/:id/respond` | first booker, admin | `grant` / `counter` + `counterTime` / `decline` |
| `POST /api/requests/:id/withdraw` | requester, admin | withdraw |
| `POST /api/sync` | member | outbox batch (≤ 20 actions, the app sends 10), one result per action |
| `PUT /api/me/prefs` | member | name, start view, notification switches |
| `POST /api/me/ical-token` | member | new iCal token (old one stops working) |
| `POST /api/push/subscribe`, `POST /api/push/unsubscribe` | member | Web Push subscription of this device |
| `GET /api/admin/users`, `POST /api/admin/users/:id/approve\|reject\|remove` | admin | user management |
| `GET /api/admin/audit?before=` | admin | full audit log, 100 per page |
| `GET /ical/:token.ics[?scope=mine]` | token | calendar feed |
| `POST /api/dev/login` | localhost only | local development and tests |

All booking mutations take a `clientId` (UUID) as idempotency key. Errors have the shape `{ ok: false, error, message }`.

## Testing

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest (Node) | time zones/DST, series expansion, grant/counter effects, calendar layout, outbox overlay |
| Integration | Vitest in workerd (`@cloudflare/vitest-plugin`) with real local D1 | every permission rule, booking/series/request flows, sync and idempotency, time-dependent rules (injected clock), iCal, notifications, backup, security headers, rate limit |
| E2E | Playwright, WebKit with iPhone 15 viewport | login page, approval, two-tap booking, overlap → request → grant, offline queue; Chromium with a virtual authenticator for passkey registration and sign-in |
