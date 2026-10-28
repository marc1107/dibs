import type { AuditEntryDto, BookingsResponse, MutationResult } from "@shared/api";
import { describe, expect, it } from "vitest";
import { book, household, login, only, rawFetch, uuid } from "./helpers";

const DAY = { startDate: "2030-05-06", endDate: "2030-05-06" };

describe("access control", () => {
  it("rejects requests without a session", async () => {
    expect((await rawFetch("/api/bookings?from=2030-01-01T00:00:00Z&to=2030-02-01T00:00:00Z")).status).toBe(401);
    expect((await rawFetch("/api/me")).status).toBe(401);
  });

  it("lets pending people see only their status, every other call ends with 403", async () => {
    await login("marc@example.com", "Marc");
    const newbie = await login("new@example.com", "Neu");
    const me = await newbie.json<{ user: { status: string; role: string } }>("/api/me");
    expect(me.body.user).toMatchObject({ status: "pending", role: "member" });
    expect((await newbie.fetch("/api/bookings?from=2030-01-01T00:00:00Z&to=2030-02-01T00:00:00Z")).status).toBe(403);
    expect((await book(newbie, DAY)).status).toBe(403);
    expect((await newbie.fetch("/api/requests")).status).toBe(403);
    expect((await newbie.fetch("/api/users")).status).toBe(403);
  });

  it("makes the ADMIN_EMAIL account admin and active automatically", async () => {
    const marc = await login("marc@example.com", "Marc");
    const me = await marc.json<{ user: { status: string; role: string } }>("/api/me");
    expect(me.body.user).toMatchObject({ status: "active", role: "admin" });
  });

  it("lets every member see all bookings", async () => {
    const { tim, lena } = await household();
    await book(tim, DAY);
    const res = await lena.json<BookingsResponse>("/api/bookings?from=2030-05-01T00:00:00Z&to=2030-06-01T00:00:00Z");
    expect(res.body.bookings).toHaveLength(1);
  });

  it("allows members to book only for themselves", async () => {
    const { tim, lena } = await household();
    expect((await book(tim, DAY)).status).toBe(201);
    const forOther = await book(tim, { ...DAY, startDate: "2030-05-07", endDate: "2030-05-07", ownerId: lena.id });
    expect(forOther.status).toBe(403);
  });

  it("allows the admin to book for others and logs it with source admin", async () => {
    const { marc, lena } = await household();
    const b = only(await book(marc, { ...DAY, ownerId: lena.id }));
    expect(b).toMatchObject({ ownerId: lena.id, createdBy: marc.id, status: "active" });
    const audit = await marc.json<{ entries: AuditEntryDto[] }>("/api/admin/audit");
    expect(audit.body.entries.find((e) => e.bookingId === b.id)).toMatchObject({ action: "booking.created", source: "admin" });
  });

  it("lets owners and the admin change or cancel a booking, but not other members", async () => {
    const { marc, tim, lena } = await household();
    const b = only(await book(tim, DAY));
    const edit = () => ({ clientId: uuid(), ...DAY, allDay: false, startTime: "08:00", endTime: "12:00" });
    expect((await lena.fetch(`/api/bookings/${b.id}`, { method: "PATCH", json: edit() })).status).toBe(403);
    expect((await lena.fetch(`/api/bookings/${b.id}/cancel`, { method: "POST", json: { clientId: uuid() } })).status).toBe(403);
    expect((await tim.fetch(`/api/bookings/${b.id}`, { method: "PATCH", json: edit() })).status).toBe(200);
    const res = await marc.json<MutationResult>(`/api/bookings/${b.id}/cancel`, { method: "POST", json: { clientId: uuid() } });
    expect(res.body).toMatchObject({ ok: true, outcome: "cancelled" });
  });

  it("keeps the admin area admin-only", async () => {
    const { tim } = await household();
    expect((await tim.fetch("/api/admin/users")).status).toBe(403);
    expect((await tim.fetch("/api/admin/audit")).status).toBe(403);
    expect((await tim.fetch(`/api/admin/users/${tim.id}/remove`, { method: "POST" })).status).toBe(403);
  });
});

describe("approval flow", () => {
  it("approves, rejects and removes people", async () => {
    const marc = await login("marc@example.com", "Marc");
    const a = await login("a@example.com", "Anna");
    const b = await login("b@example.com", "Ben");
    expect((await marc.fetch(`/api/admin/users/${a.id}/approve`, { method: "POST" })).status).toBe(200);
    expect((await marc.fetch(`/api/admin/users/${b.id}/reject`, { method: "POST" })).status).toBe(200);
    expect((await a.json<{ user: { status: string } }>("/api/me")).body.user.status).toBe("active");
    // Rejected: session revoked, and signing in again is refused.
    expect((await b.fetch("/api/me")).status).toBe(401);
    await expect(login("b@example.com")).rejects.toThrow(/403/);
  });

  it("revokes sessions, feed and future bookings of removed members but keeps their past bookings", async () => {
    const { marc, tim } = await household();
    const past = only(await book(tim, { startDate: "2020-01-01", endDate: "2020-01-01" }));
    const future = only(await book(tim, DAY));
    const me = await tim.json<{ icalUrl: string }>("/api/me");
    const feedPath = new URL(me.body.icalUrl.replace("webcal:", "http:")).pathname;
    expect((await rawFetch(feedPath)).status).toBe(200);

    expect((await marc.fetch(`/api/admin/users/${tim.id}/remove`, { method: "POST" })).status).toBe(200);
    expect((await tim.fetch("/api/me")).status).toBe(401);
    expect((await rawFetch(feedPath)).status).toBe(404);
    await expect(login("tim@example.com")).rejects.toThrow(/403/);

    const all = await marc.json<BookingsResponse>("/api/bookings?from=2019-12-01T00:00:00Z&to=2031-01-01T00:00:00Z");
    expect(all.body.bookings.map((x) => x.id)).toEqual([past.id]);
    const detail = await marc.json<{ booking: { status: string } }>(`/api/bookings/${future.id}`);
    expect(detail.body.booking.status).toBe("cancelled");
  });

  it("does not let the admin remove themselves", async () => {
    const marc = await login("marc@example.com", "Marc");
    expect((await marc.fetch(`/api/admin/users/${marc.id}/remove`, { method: "POST" })).status).toBe(403);
  });
});
