import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { rawFetch } from "./helpers";

const worker = (exports as unknown as { default: Fetcher }).default;

describe("security", () => {
  it("sends strict security headers on API responses", async () => {
    const res = await rawFetch("/api/health");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("rate-limits the auth endpoints per client IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      const res = await rawFetch("/api/auth/get-session", { headers: { "cf-connecting-ip": "203.0.113.7" } });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    const other = await rawFetch("/api/auth/get-session", { headers: { "cf-connecting-ip": "203.0.113.8" } });
    expect(other.status).not.toBe(429);
  });

  it("requires a Turnstile token for Google sign-in", async () => {
    const res = await rawFetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });
    expect(res.status).toBe(400);
  });

  it("does not expose the dev login on other hosts", async () => {
    const res = await worker.fetch(
      new Request("https://auto.example.com/api/dev/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "marc@example.com" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("answers unknown API paths with JSON 404 after auth", async () => {
    expect((await rawFetch("/api/nope")).status).toBe(401);
  });
});
