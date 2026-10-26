import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const TABLES = [
  "audit_log", "request", "booking", "series", "client_action", "notification_pref",
  "push_subscription", "passkey", "session", "account", "verification", "user",
];

// Storage is shared between tests of a file, so every test starts from an empty database.
beforeEach(async () => {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM "${t}"`)));
});
