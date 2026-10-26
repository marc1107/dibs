import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** A day in the next month, so it is never in the past. */
export function nextMonthDay(day: number) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));
  return { iso: d.toISOString().slice(0, 10), label: `${day}. ${MONTHS[d.getUTCMonth()]}` };
}

export async function devLogin(page: Page, email: string, name: string) {
  const res = await page.request.post("/api/dev/login", { data: { email, name } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { userId: string }).userId;
}

export async function newUser(browser: Browser, email: string, name: string): Promise<{ context: BrowserContext; page: Page; id: string }> {
  const context = await browser.newContext({ baseURL: "http://localhost:5173", locale: "de-DE", timezoneId: "Europe/Berlin", viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  const id = await devLogin(page, email, name);
  return { context, page, id };
}

/** Admin plus two approved members, approved through the admin API. */
export async function household(browser: Browser, page: Page) {
  const marcId = await devLogin(page, "marc@example.com", "Marc");
  const tim = await newUser(browser, "tim@example.com", "Tim");
  const lena = await newUser(browser, "lena@example.com", "Lena");
  for (const u of [tim, lena]) await page.request.post(`/api/admin/users/${u.id}/approve`);
  return { marcId, tim, lena };
}

export async function gotoNextMonth(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Weiter" }).click();
}
