import { expect, test } from "@playwright/test";
import { devLogin } from "./helpers";

test("registers a passkey after approval and signs in with it", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });

  await devLogin(page, "marc@example.com", "Marc");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page.getByText("Face ID eingerichtet")).toBeVisible();
  await expect(page.getByText("1 eingerichtet")).toBeVisible();

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: /Mit Passkey/ }).click();
  await expect(page.getByRole("heading", { name: "Auto", exact: true })).toBeVisible();
});
