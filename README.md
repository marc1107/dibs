# Schlüsselbrett

A small PWA for a shared car: three people (an admin and two members) reserve the car with two taps and always see who has it when. Runs entirely on the Cloudflare free plan.

- **Two taps** for the common case: tap a day, tap "Reservieren". A second day tap makes a range; times and weekly/biweekly repeats are one tap away.
- **Closed group:** Google sign-in once, admin approval, then passkeys (Face ID).
- **First come, first served, nobody gets overwritten:** an overlapping booking becomes a request that the first booker answers with *Klar, nimm's* / *Brauch's bis X* / *Nein*.
- **Offline:** last loaded data stays readable, new bookings, edits and cancellations queue in an outbox and are sent when the app is back online.
- **Web Push** (installed PWA, iOS 16.4+), **iCal feed** per person, reminders via cron, weekly backup to R2, full audit log.

| Part | Choice |
|---|---|
| Frontend | React 19, Vite, TanStack Query (persisted to IndexedDB), Tailwind CSS 4, vite-plugin-pwa (Workbox) |
| Backend | Hono on Cloudflare Workers (API, auth, iCal and static assets from one Worker) |
| Data | Cloudflare D1 + Drizzle ORM, R2 for backups |
| Auth | Better Auth: Google OAuth + passkey plugin, Cloudflare Turnstile, Workers Rate Limiting |
| Tests | Vitest (unit + integration inside workerd with real local D1), Playwright (iPhone viewport) |

## Quick start (local)

```bash
pnpm install
cp .dev.vars.example .dev.vars        # then run `pnpm vapid` and paste the keys
pnpm db:apply:local                   # create the local D1 schema
pnpm dev                              # http://localhost:5173
```

Locally you sign in with the **Dev-Login** box on the login page (only rendered by `vite dev`, and the server only accepts it on `localhost` with `DEV_LOGIN=true`). `marc@example.com` (the `ADMIN_EMAIL` in `.dev.vars`) becomes admin; any other address starts as pending and can be approved under *Verwaltung*.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server with the Worker and local D1 (Miniflare) |
| `pnpm build` / `pnpm preview` | Production build / serve it locally (service worker active) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript for client, worker and tooling |
| `pnpm test` | Vitest: unit tests and Worker integration tests against a real local D1 |
| `pnpm test:e2e` | Playwright against a fresh local stack (`scripts/e2e-server.mjs`) |
| `pnpm db:generate` | Generate a migration from `src/worker/db/schema.ts` |
| `pnpm db:apply:local` / `pnpm db:apply:remote` | Apply migrations to local / production D1 |
| `pnpm vapid` | Generate a VAPID key pair for Web Push |
| `pnpm deploy` | Build and deploy (normally done by `deploy.yml`) |

## Documentation

- [docs/SETUP.md](docs/SETUP.md): everything that still has to be filled in before the first deploy
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): structure, data model, booking/request rules, offline sync, API
- [docs/DECISIONS.md](docs/DECISIONS.md): decisions taken during implementation and deviations from the spec
- [docs/OPERATIONS.md](docs/OPERATIONS.md): deploys, backups and restore, maintenance
- [CLAUDE.md](CLAUDE.md): conventions for working on this repository
