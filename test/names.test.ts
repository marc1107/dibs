import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { login } from "./helpers";

describe("first names only", () => {
  it("stores only the first name of a new account", async () => {
    const luca = await login("luca@example.com", "Luca Nuber");
    const me = await luca.json<{ user: { name: string } }>("/api/me");
    expect(me.body.user.name).toBe("Luca");
  });

  it("migration shortens existing full names", async () => {
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, email_verified, role, status, color, ical_token, created_at, updated_at)
       VALUES ('u1', 'Sophie Bohner', 's@example.com', 1, 'member', 'active', '#2563EB', 't1', 0, 0),
              ('u2', 'Marc', 'm@example.com', 1, 'admin', 'active', '#C2410C', 't2', 0, 0)`,
    ).run();
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.includes("first_names"));
    expect(migration).toBeDefined();
    await env.DB.batch(migration!.queries.map((q) => env.DB.prepare(q)));
    const rows = await env.DB.prepare(`SELECT id, name FROM "user" ORDER BY id`).all<{ id: string; name: string }>();
    expect(rows.results).toEqual([
      { id: "u1", name: "Sophie" },
      { id: "u2", name: "Marc" },
    ]);
  });
});
