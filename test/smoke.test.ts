import { describe, expect, it } from "vitest";
import { login, rawFetch } from "./helpers";

describe("smoke", () => {
  it("answers health checks", async () => {
    const res = await rawFetch("/api/health");
    expect(res.status).toBe(200);
  });

  it("signs in the admin via dev login", async () => {
    const marc = await login("marc@example.com", "Marc");
    const me = await marc.json<{ user: { role: string; status: string } }>("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ role: "admin", status: "active" });
  });
});
