# CLAUDE.md

Shared-car reservation PWA on Cloudflare Workers. Read `docs/ARCHITECTURE.md` before changing booking or request rules, and record new product or technical decisions in `docs/DECISIONS.md`.

## Commands

```bash
pnpm dev              # vite dev with Worker + local D1 (http://localhost:5173, Dev-Login on the login page)
pnpm lint && pnpm typecheck
pnpm test             # Vitest: src/**/*.test.ts (unit, Node) + test/**/*.test.ts (workerd + real local D1)
pnpm test:e2e         # Playwright; starts its own stack on :5173 (stop `pnpm dev` first), needs .dev.vars
pnpm db:generate      # after changing src/worker/db/schema.ts, then pnpm db:apply:local
pnpm exec wrangler types src/worker/worker-configuration.d.ts   # after changing wrangler.jsonc
```

## Conventions

- UI text is German, code, comments, docs, commits and PRs are English.
- Domain logic that both sides need lives in `src/shared` as pure functions with unit tests. Validation only through the Zod schemas in `src/shared/schemas.ts`.
- Worker: routes stay thin (validate, call a service, return JSON). Services take a `ServiceCtx` with an injectable `now`; permission checks happen in the services, never only in the UI.
- Multi-statement writes go through `runBatch` (`src/worker/lib/batch.ts`): one D1 batch is one transaction. Drizzle's own `db.batch` cannot carry raw `sql` on D1.
- Every booking mutation carries a client UUID and runs through `once()` (idempotency). Every change writes an audit entry.
- Times: store UTC ISO strings, compute in Berlin wall-clock time via `src/shared/time.ts`. Never use `new Date().getHours()` style local time on the server.
- Client styling: use the colour tokens from `src/client/index.css` (they switch for dark mode), never hard-coded hex values in components. Motion constants live in `src/client/lib/motion.ts`; anything that slides in must leave the same way (see DECISIONS #48).
- Client: booking mutations go through the outbox (`src/client/lib/outbox.ts`); read data with the hooks in `src/client/lib/queries.ts`. Keep `CACHE_TIME` below 24 days.
- Tests: integration tests reset the database before each test (`test/setup.ts`) and sign in via `/api/dev/login`. Time-dependent rules are tested by calling services with a fixed `now`.
- Never put secrets or personal data in `wrangler.jsonc` (public repo); see `docs/SETUP.md`.
