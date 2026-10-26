import { describe, expect, it } from "vitest";
import { book, household, rawFetch, uuid, type Client } from "./helpers";

async function feedPath(c: Client) {
  const me = await c.json<{ icalUrl: string }>("/api/me");
  expect(me.body.icalUrl).toMatch(/^webcal:\/\/localhost\/ical\/[A-Za-z0-9_-]{43}\.ics$/);
  return new URL(me.body.icalUrl.replace("webcal:", "http:")).pathname;
}

describe("iCal feed", () => {
  it("contains active bookings with names and notes, but no e-mail addresses", async () => {
    const { tim, lena } = await household();
    await book(lena, { startDate: "2030-11-05", endDate: "2030-11-05", note: "Umzug, Teil 2; Kisten" });
    await book(tim, { startDate: "2030-11-06", endDate: "2030-11-06", allDay: false, startTime: "17:00", endTime: "22:00" });
    const cancelled = await book(tim, { startDate: "2030-11-07", endDate: "2030-11-07" });
    if (cancelled.body.ok) await tim.fetch(`/api/bookings/${cancelled.body.bookings[0]!.id}/cancel`, { method: "POST", json: { clientId: uuid() } });

    const res = await rawFetch(await feedPath(tim));
    expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
    const text = await res.text();
    expect(text).toContain("SUMMARY:Auto: Lena");
    expect(text).toContain("DESCRIPTION:Umzug\\, Teil 2\\; Kisten");
    expect(text).toContain("DTSTART;VALUE=DATE:20301105");
    expect(text).toContain("DTEND;VALUE=DATE:20301106");
    expect(text).toContain("DTSTART:20301106T160000Z");
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).not.toContain("@example.com");
    expect(text).toMatch(/\r\n/);
  });

  it("can be limited to own bookings", async () => {
    const { tim, lena } = await household();
    await book(lena, { startDate: "2030-11-05", endDate: "2030-11-05" });
    await book(tim, { startDate: "2030-11-06", endDate: "2030-11-06" });
    const text = await (await rawFetch(`${await feedPath(tim)}?scope=mine`)).text();
    expect(text).toContain("Auto: Tim");
    expect(text).not.toContain("Auto: Lena");
  });

  it("invalidates the old link immediately when a new one is generated", async () => {
    const { tim } = await household();
    const old = await feedPath(tim);
    const res = await tim.json<{ icalUrl: string }>("/api/me/ical-token", { method: "POST" });
    expect((await rawFetch(old)).status).toBe(404);
    expect((await rawFetch(new URL(res.body.icalUrl.replace("webcal:", "http:")).pathname)).status).toBe(200);
  });

  it("returns 404 for unknown tokens", async () => {
    expect((await rawFetch("/ical/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics")).status).toBe(404);
  });
});
