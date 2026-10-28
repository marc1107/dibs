import { expect, test } from "@playwright/test";
import { devLogin, gotoNextMonth, household, newUser, nextMonthDay } from "./helpers";

test.describe.configure({ mode: "serial" });

test("shows the login page to signed-out visitors", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "dibs" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mit Passkey/ })).toBeVisible();
});

test("keeps new people waiting until the admin approves them", async ({ page, browser }) => {
  await devLogin(page, "marc@example.com", "Marc");
  const newbie = await newUser(browser, "neu@example.com", "Neu");
  await newbie.page.goto("/");
  await expect(newbie.page.getByText("Wartet auf Freigabe")).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByText("neu@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Freischalten" }).click();
  await expect(page.getByText("Freigabe-Anfragen (0)")).toBeVisible();

  await newbie.page.reload();
  await expect(newbie.page.getByRole("heading", { name: "dibs", exact: true })).toBeVisible();
  await newbie.context.close();
});

test("books a whole day with two taps", async ({ page, browser }) => {
  await household(browser, page);
  const day = nextMonthDay(10);
  await gotoNextMonth(page);
  await page.getByRole("button", { name: new RegExp(`^${day.label}`) }).click();
  await page.getByRole("region", { name: "Auswahl" }).getByRole("button", { name: "Reservieren" }).click();
  await expect(page.getByRole("button", { name: `${day.label}, Marc` })).toBeVisible();
});

test("turns an overlap into a request that the first booker can grant", async ({ page, browser }) => {
  const { tim, lena } = await household(browser, page);
  const day = nextMonthDay(12);

  await gotoNextMonth(tim.page);
  await tim.page.getByRole("button", { name: new RegExp(`^${day.label}`) }).click();
  await tim.page.getByRole("region", { name: "Auswahl" }).getByRole("button", { name: "Reservieren" }).click();
  await expect(tim.page.getByRole("button", { name: `${day.label}, Tim` })).toBeVisible();

  await gotoNextMonth(lena.page);
  await lena.page.getByRole("button", { name: `${day.label}, Tim` }).click();
  await lena.page.getByRole("region", { name: "Auswahl" }).getByRole("button", { name: "Uhrzeit …" }).click();
  const sheet = lena.page.getByRole("dialog", { name: "Reservieren" });
  await sheet.getByRole("radio", { name: "Mit Uhrzeit" }).click();
  await sheet.getByLabel("Von").selectOption("18:00");
  await sheet.getByLabel("Bis").selectOption("23:00");
  await expect(sheet.getByText("Überschneidet sich mit Tim")).toBeVisible();
  await sheet.getByRole("button", { name: "Tim fragen" }).click();
  await expect(lena.page.getByText("Wird zur Anfrage")).toBeVisible();

  await tim.page.goto("/");
  await tim.page.getByText("1 Anfrage wartet auf deine Antwort").click();
  await tim.page.getByText("Lena möchte das Auto").click();
  await tim.page.getByRole("button", { name: /Klar, nimm's/ }).click();
  await expect(tim.page.getByText("Antwort gesendet")).toBeVisible();

  await lena.page.goto("/requests");
  await expect(lena.page.getByText("Du hast gerade keine offenen Anfragen.")).toBeVisible();
  await tim.context.close();
  await lena.context.close();
});

test("queues bookings while offline and sends them when back online", async ({ page, browser, context }) => {
  await household(browser, page);
  const day = nextMonthDay(20);
  await gotoNextMonth(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: new RegExp(`^${day.label}`) }).click();
  await page.getByRole("region", { name: "Auswahl" }).getByRole("button", { name: "Reservieren" }).click();
  await expect(page.getByText("1 Buchung noch nicht gesendet")).toBeVisible();
  await expect(page.getByText(/Offline/).first()).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("1 Buchung noch nicht gesendet")).toBeHidden({ timeout: 15_000 });
  const res = await page.request.get("/api/history");
  const history = (await res.json()) as { audit: { action: string; source: string }[] };
  expect(history.audit.find((a) => a.action === "booking.created")?.source).toBe("offline-sync");
});
