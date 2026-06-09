import { expect, test } from "@playwright/test";

test("top page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
